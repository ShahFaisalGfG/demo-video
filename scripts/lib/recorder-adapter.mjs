import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { hideCursor, recordPage, showCursor } from 'testreel';
import { HumanCursor, POINTER_ACTIONS, boxCenter, cursorSettings, zoomPage } from './human-cursor.mjs';
import { watchTestreelFailures } from './testreel-failures.mjs';

const RECORDING_FILES = new Set(['.webm', '.mp4', '.gif', '.png', '.json']);
// testreel nests one FFmpeg expression level per cursor move; past this count its post-processing fails.
const LINEAR_MOVE_LIMIT = 48;

function cleanOutput(outputDir) {
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (entry.isFile() && RECORDING_FILES.has(path.extname(entry.name).toLowerCase())) {
      fs.rmSync(path.join(outputDir, entry.name));
    }
  }
}

function resolveVars(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, variable) => process.env[variable] ?? '');
}

function locator(page, selector) {
  return page.locator(resolveVars(selector)).first();
}

async function prepareSelector(page, selector, step) {
  const resolved = resolveVars(selector);
  const matches = page.locator(resolved);
  const count = await matches.count();
  if (!step.allowMultiple && count !== 1) {
    throw new Error(`selector ${JSON.stringify(resolved)} matched ${count} elements; expected exactly 1`);
  }
  const target = matches.first();
  await target.waitFor({ state: 'attached', timeout: step.timeout ?? 8000 });
  await target.scrollIntoViewIfNeeded();
  await target.waitFor({ state: 'visible', timeout: step.timeout ?? 8000 });
  return target;
}

async function assertStep(page, step) {
  const target = locator(page, step.selector);
  if (step.kind === 'count') {
    const count = await page.locator(resolveVars(step.selector)).count();
    if ((step.equals !== undefined && count !== step.equals) ||
        (step.min !== undefined && count < step.min) ||
        (step.max !== undefined && count > step.max)) {
      throw new Error(`assert count failed for ${step.selector}: ${count}`);
    }
    return;
  }
  if (step.kind === 'hidden') {
    if (!(await target.isHidden())) throw new Error(`assert hidden failed for ${step.selector}`);
    return;
  }
  await target.waitFor({ state: 'attached', timeout: step.timeout ?? 8000 });
  if (step.kind === 'text') {
    const actual = (await target.innerText()).trim();
    const passed = step.equals !== undefined
      ? actual === resolveVars(step.equals)
      : actual.includes(resolveVars(step.text ?? ''));
    if (!passed) throw new Error(`assert text failed for ${step.selector}`);
  } else if (step.kind === 'visible' && !(await target.isVisible())) throw new Error(`assert visible failed for ${step.selector}`);
  else if (step.kind === 'enabled' && !(await target.isEnabled())) throw new Error(`assert enabled failed for ${step.selector}`);
  else if (step.kind === 'disabled' && await target.isEnabled()) throw new Error(`assert disabled failed for ${step.selector}`);
  else if (step.kind === 'checked' && !(await target.isChecked())) throw new Error(`assert checked failed for ${step.selector}`);
  else if (step.kind === 'unchecked' && await target.isChecked()) throw new Error(`assert unchecked failed for ${step.selector}`);
  else if (step.kind === 'value' && (await target.inputValue()) !== resolveVars(step.value)) {
    throw new Error(`assert value failed for ${step.selector}`);
  }
}

async function conditionMatches(page, condition) {
  const target = locator(page, condition.selector);
  let matched;
  if (condition.state === 'attached') matched = (await target.count()) > 0;
  else if (condition.state === 'checked') matched = await target.isChecked().catch(() => false);
  else if (condition.state === 'enabled') matched = await target.isEnabled().catch(() => false);
  else if (condition.state === 'text') {
    matched = (await target.innerText().catch(() => '')).includes(resolveVars(condition.text ?? ''));
  } else matched = await target.isVisible().catch(() => false);
  return condition.not ? !matched : matched;
}

async function waitBeforeStep(page, step) {
  if (!step.waitFor) return;
  if (step.waitFor === 'networkidle') {
    await page.waitForLoadState('networkidle', { timeout: step.timeout ?? 5000 });
  } else {
    await locator(page, step.waitFor).waitFor({ state: 'visible', timeout: step.timeout ?? 5000 });
  }
}

async function setupStep(page, step) {
  const target = step.selector ? locator(page, step.selector) : null;
  switch (step.action) {
    case 'wait': await page.waitForTimeout(step.ms ?? 1000); break;
    case 'click': await target.click({ timeout: step.timeout ?? 8000 }); break;
    case 'type': await target.pressSequentially(resolveVars(step.text), { delay: step.delay ?? 80 }); break;
    case 'fill': await target.fill(resolveVars(step.text)); break;
    case 'clear': await target.fill(''); break;
    case 'select': await target.selectOption(step.value); break;
    case 'check': await target.check(); break;
    case 'uncheck': await target.uncheck(); break;
    case 'upload': await target.setInputFiles(Array.isArray(step.files) ? step.files.map(resolveVars) : resolveVars(step.files)); break;
    case 'keyboard': await page.keyboard.press(step.key); break;
    default: throw new Error(`Unsupported setup action ${step.action}.`);
  }
}

/** Count the cursor moves testreel would composite, both branches of every condition included. */
function cursorMoves(steps = []) {
  return steps.reduce((total, step) => total + (POINTER_ACTIONS.includes(step.action) || step.action === 'upload' ? 1 : 0)
    + cursorMoves(step.then) + cursorMoves(step.else), 0);
}

async function executeStep(recorder, step, cursor) {
  const page = recorder.page;
  await waitBeforeStep(page, step);
  const selector = step.selector ? resolveVars(step.selector) : null;
  if (cursor?.zoomOutPending) {
    cursor.zoomOutPending = false;
    await zoomPage(page, null, 1);
  }
  if (selector && [...POINTER_ACTIONS, 'zoom'].includes(step.action)) {
    await prepareSelector(page, selector, step);
  }
  // With the human cursor, the adapter zooms the page itself; testreel's zoom needs its own cursor events.
  const clickZoom = Boolean(cursor) && ['click', 'clickResponse'].includes(step.action) && step.zoom > 1;
  if (clickZoom) await zoomPage(page, await boxCenter(locator(page, selector)), step.zoom);
  if (cursor && selector && POINTER_ACTIONS.includes(step.action)) await cursor.moveTo(locator(page, selector));
  const zoom = cursor ? undefined : step.zoom;
  let includesBuiltInPause = false;
  switch (step.action) {
    case 'wait': await recorder.wait(step.ms ?? 1000); includesBuiltInPause = true; break;
    case 'click': await recorder.click(selector, { timeout: step.timeout, zoom, zoomOut: step.zoomOut }); includesBuiltInPause = true; break;
    case 'type': await recorder.type(selector, resolveVars(step.text), { delay: step.delay, clear: step.clear, timeout: step.timeout }); includesBuiltInPause = true; break;
    case 'fill': await recorder.fill(selector, resolveVars(step.text), { timeout: step.timeout }); includesBuiltInPause = true; break;
    case 'hover': await recorder.hover(selector, { timeout: step.timeout }); includesBuiltInPause = true; break;
    case 'scroll': await recorder.scroll({ x: step.x, y: step.y, scrollSpeed: step.scrollSpeed }); includesBuiltInPause = true; break;
    case 'zoom':
      if (cursor) {
        const point = selector ? await boxCenter(locator(page, selector)) : step.x !== undefined ? { x: step.x, y: step.y } : null;
        await zoomPage(page, point, step.scale ?? 2, step.duration ?? 600);
      } else {
        await recorder.zoom({ selector, scale: step.scale, x: step.x, y: step.y, duration: step.duration });
        includesBuiltInPause = true;
      }
      break;
    case 'keyboard': await recorder.keyboard(step.key); includesBuiltInPause = true; break;
    case 'navigate': await recorder.navigate(resolveVars(step.url)); includesBuiltInPause = true; break;
    case 'screenshot': await recorder.screenshot(step.name); includesBuiltInPause = true; break;
    case 'clear': await recorder.fill(selector, '', { timeout: step.timeout }); includesBuiltInPause = true; break;
    case 'select':
      await recorder.hover(selector, { timeout: step.timeout });
      await locator(page, selector).selectOption(step.value);
      break;
    case 'upload': {
      const visual = resolveVars(step.visualSelector ?? step.selector);
      await prepareSelector(page, visual, step);
      if (cursor) await cursor.moveTo(locator(page, visual));
      await locator(page, selector).waitFor({ state: 'attached', timeout: step.timeout ?? 8000 });
      await recorder.hover(visual, { timeout: step.timeout });
      await locator(page, selector).setInputFiles(Array.isArray(step.files) ? step.files.map(resolveVars) : resolveVars(step.files));
      break;
    }
    case 'check':
    case 'uncheck':
      await recorder.hover(selector, { timeout: step.timeout });
      if (cursor) await cursor.ripple();
      if (step.action === 'check') await locator(page, selector).check();
      else await locator(page, selector).uncheck();
      break;
    case 'clickResponse': {
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes(resolveVars(step.urlPattern)) &&
          (!step.method || response.request().method() === step.method),
        { timeout: step.timeout ?? 10000 },
      );
      const [, response] = await Promise.all([
        recorder.click(selector, { timeout: step.timeout, zoom, zoomOut: step.zoomOut }),
        responsePromise,
      ]);
      includesBuiltInPause = true;
      if (step.status !== undefined && response.status() !== step.status) {
        throw new Error(`response status ${response.status()} did not equal ${step.status}`);
      }
      break;
    }
    case 'assert': await assertStep(page, step); break;
    case 'if': {
      const branch = await conditionMatches(page, step.condition) ? step.then : (step.else ?? []);
      for (const nested of branch ?? []) await executeStep(recorder, nested, cursor);
      break;
    }
    case 'waitForNetwork':
      await page.waitForResponse((response) => response.url().includes(resolveVars(step.urlPattern)), {
        timeout: step.timeout ?? 10000,
      });
      break;
    case 'hideCursor': await (cursor ? cursor.hide() : hideCursor(page)); break;
    case 'showCursor': await (cursor ? cursor.show() : showCursor(page)); break;
    default: throw new Error(`Unknown action ${step.action}.`);
  }
  if (clickZoom && step.zoomOut !== false) cursor.zoomOutPending = true;
  if (step.action !== 'wait') {
    const requiredPause = step.pauseAfter ?? 500;
    const remainingPause = includesBuiltInPause ? Math.max(0, requiredPause - 500) : requiredPause;
    if (remainingPause) await page.waitForTimeout(remainingPause);
  }
}

export async function recordDefinition(definitionPath, options = {}) {
  const definition = typeof definitionPath === 'string'
    ? JSON.parse(fs.readFileSync(definitionPath, 'utf8'))
    : structuredClone(definitionPath);
  const outputDir = options.outputDir ?? './testreel-output';
  fs.mkdirSync(outputDir, { recursive: true });
  if (options.clean) cleanOutput(outputDir);
  const cursorMode = cursorSettings(definition);
  if (cursorMode.enabled && !cursorMode.human && cursorMoves(definition.steps) > LINEAR_MOVE_LIMIT) {
    throw new Error(`cursor.motion "linear" supports at most ${LINEAR_MOVE_LIMIT} cursor moves per recording; `
      + 'testreel drops the cursor, chrome, and background beyond that. Use the default "human" motion or split the recording.');
  }
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const stateCandidate = definition.storageState ? path.resolve(resolveVars(definition.storageState)) : undefined;
  let state = stateCandidate && fs.existsSync(stateCandidate) ? stateCandidate : undefined;
  let setupScroll = null;
  try {
    if (definition.setup) {
      const setupContext = await browser.newContext({
        viewport: definition.viewport,
        colorScheme: definition.colorScheme,
        storageState: state,
        extraHTTPHeaders: definition.headers,
      });
      try {
        if (definition.cookies?.length) await setupContext.addCookies(definition.cookies);
        const setupPage = await setupContext.newPage();
        await setupPage.goto(resolveVars(definition.setup.url ?? definition.url), { waitUntil: 'load', timeout: 20_000 });
        if (definition.localStorage && Object.keys(definition.localStorage).length) {
          await setupPage.evaluate((entries) => {
            for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
          }, definition.localStorage);
          await setupPage.reload({ waitUntil: 'load', timeout: 20_000 });
        }
        for (const step of definition.setup.steps ?? []) await setupStep(setupPage, step);
        setupScroll = await setupPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
        state = await setupContext.storageState();
      } finally {
        await setupContext.close();
      }
    }

    const viewport = definition.viewport ?? { width: 1280, height: 720 };
    const context = await browser.newContext({
      viewport,
      colorScheme: definition.colorScheme ?? 'light',
      storageState: state,
      extraHTTPHeaders: definition.headers,
      recordVideo: { dir: outputDir, size: viewport },
    });
    if (cursorMode.human) await HumanCursor.install(context, cursorMode.options);
    if (!definition.setup && definition.cookies?.length) await context.addCookies(definition.cookies);
    const videoStartedAt = Date.now();
    const page = await context.newPage();
    const cursor = cursorMode.human ? new HumanCursor(page, viewport, definition.steps) : null;
    if (!definition.setup && definition.localStorage && Object.keys(definition.localStorage).length) {
      await page.goto(resolveVars(definition.url), { waitUntil: 'commit', timeout: 20_000 });
      await page.evaluate((entries) => {
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      }, definition.localStorage);
      await page.reload({ waitUntil: 'load', timeout: 20_000 });
    } else {
      await page.goto(resolveVars(definition.url), { waitUntil: 'load', timeout: 20_000 });
    }
    if (setupScroll) await page.evaluate((position) => window.scrollTo(position.x, position.y), setupScroll);
    if (definition.waitForSelector) {
      await page.locator(resolveVars(definition.waitForSelector)).first().waitFor({
        state: 'visible', timeout: 10_000,
      });
    }
    const recorder = await recordPage(page, {
      outputDir,
      name: path.basename(typeof definitionPath === 'string' ? definitionPath : 'recording', '.json'),
      cursor: cursorMode.human ? false : definition.cursor,
      chrome: definition.chrome,
      background: definition.background,
      speed: definition.speed,
      outputFormat: definition.outputFormat ?? 'mp4',
      keepIntermediates: definition.keepIntermediates,
      videoStartedAt,
    });
    for (const step of definition.steps ?? []) await executeStep(recorder, step, cursor);
    if (cursor?.zoomOutPending) await zoomPage(page, null, 1);
    const watch = watchTestreelFailures();
    let result;
    try {
      result = await recorder.stop();
    } finally {
      watch.stop();
    }
    if (watch.failures.length) {
      throw new Error(`testreel ${watch.failures.join('; ')}. The capture lacks its cursor, frame, or speed treatment.`);
    }
    return result;
  } finally {
    await browser.close();
  }
}
