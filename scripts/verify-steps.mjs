// CAVEAT (learned the hard way): the scroll-coverage check below reads
// `document.documentElement.scrollHeight` via `page.evaluate()` before every click, which
// forces a synchronous layout recalculation. On at least one live app, that forced-layout
// read - not present in testreel's own action handlers - was enough to occasionally trip a
// page's own React rendering instability and make an otherwise-fine click time out. If this
// script reports a click failure that a manual, standalone Playwright click (with no
// scrollHeight polling beforehand) does NOT reproduce, don't trust the failure as selector
// evidence - it may be this script's own instrumentation, not the recording.json. The live
// render (generate-narration.mjs + compile-video.mjs) doesn't poll scrollHeight this way and
// is the authoritative test either way.
//
// Optional dry-run: structurally replays a recording.json against the live dev server -
// live clicks/types/scrolls, no cursor animation, no narration synthesis - so broken
// selectors and insufficient scroll coverage surface in seconds, not after a full narrated
// render. Run this after writing/editing a recording.json and before generate-narration.mjs.
//
// Usage: node ~/.demo_video/scripts/verify-steps.mjs demo/<name>.recording.json
//
// What it catches that a human skim of the JSON won't:
//   - A selector that's syntactically fine but never resolves against the live DOM.
//   - A `scroll` sequence that never directly reaches the bottom of a tall section before
//     the next tab switch (or the end of the recording) - the single most common way a
//     generated demo video silently cuts off content the narration is describing.
//   - A `role=TAG[name="..."]` selector that's likely hitting the accessibility-tree
//     staleness bug described in reference.md (element exists and is visible via plain CSS,
//     but the accessibility-tree-backed role= lookup times out anyway).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { browsersDir, demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? browsersDir(demoVideoHome());
const { chromium } = await import('playwright');
const { ensureAuthState } = await import('./lib/auth-refresh.mjs');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node verify-steps.mjs demo/<name>.recording.json');
  process.exit(1);
}

function resolveVars(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, v) => process.env[v] ?? '');
}

const def = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const name = inputPath.split(/[\\/]/).pop().replace(/\.recording\.json$/, '');
await ensureAuthState(def);

// Static pre-flight: catch the "[role=\"button\"]:has-text(...)" bug before spending any
// time running the browser. Roles with a native HTML equivalent never carry the literal
// role="..." attribute, so this selector shape matches zero elements, always - see
// reference.md "Notes & caveats".
const NATIVE_ROLE_TAGS_STATIC = { button: 'button', link: 'a', checkbox: 'input', textbox: 'input', select: 'select' };
function lintSelectors(node, path, warnings) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => lintSelectors(item, `${path}[${i}]`, warnings));
  } else if (node && typeof node === 'object') {
    if (typeof node.selector === 'string') {
      const m = node.selector.match(/^\[role="([a-zA-Z-]+)"\]:has-text\(/);
      if (m && NATIVE_ROLE_TAGS_STATIC[m[1]]) {
        warnings.push(`${path}.selector = ${JSON.stringify(node.selector)} - role "${m[1]}" has a native HTML ` +
          `equivalent (<${NATIVE_ROLE_TAGS_STATIC[m[1]]}>), so this will match zero elements. Use "${NATIVE_ROLE_TAGS_STATIC[m[1]]}:has-text(...)" instead.`);
      }
    }
    for (const key of Object.keys(node)) lintSelectors(node[key], `${path}.${key}`, warnings);
  }
}
const lintWarnings = [];
lintSelectors(def, 'recording', lintWarnings);
if (lintWarnings.length) {
  console.log(`\n=== ${name}: pre-flight selector lint (${lintWarnings.length} issue(s)) ===`);
  for (const w of lintWarnings) console.log(' - ' + w);
  console.log('Fix these before the dry run - they will silently no-op regardless of timeout.\n');
}

const browser = await chromium.launch({ headless: true });
const contextOptions = {};
if (def.viewport) contextOptions.viewport = def.viewport;
if (def.colorScheme) contextOptions.colorScheme = def.colorScheme;
if (def.storageState) contextOptions.storageState = path.resolve(resolveVars(def.storageState));
if (def.headers) contextOptions.extraHTTPHeaders = def.headers;
const context = await browser.newContext(contextOptions);
if (def.cookies?.length) await context.addCookies(def.cookies);
const page = await context.newPage();

const issues = [];
let peakY = 0;
let peakMax = 0;

async function trackPeak() {
  try {
    const { y, max } = await page.evaluate(() => ({ y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }));
    peakY = Math.max(peakY, y);
    peakMax = Math.max(peakMax, max);
  } catch {
    // page was navigating at the moment we sampled - skip this sample, not a live issue.
  }
}

const NATIVE_ROLE_TAGS = { button: 'button', link: 'a', checkbox: 'input', textbox: 'input', select: 'select' };

function roleSelectorHint(sel) {
  // [role="X"]:has-text(...) failing is the common live bug: for roles with a native HTML
  // tag equivalent (button, link, ...), authors correctly never set the attribute
  // explicitly - the CSS selector then matches zero elements, always, not intermittently.
  const cssMatch = sel && sel.match(/^\[role="([a-zA-Z-]+)"\]:has-text\(/);
  if (cssMatch && NATIVE_ROLE_TAGS[cssMatch[1]]) {
    const tag = NATIVE_ROLE_TAGS[cssMatch[1]];
    return ` - role "${cssMatch[1]}" has a native HTML equivalent (<${tag}>), which never carries a literal ` +
      `role="${cssMatch[1]}" attribute. This selector likely matches zero elements - try "${tag}:has-text(...)" ` +
      'instead, not a longer timeout (see reference.md "Notes & caveats").';
  }
  return '';
}

async function runStep(step, idx, label) {
  const sel = step.selector ? resolveVars(step.selector) : undefined;
  console.log(`[${label}#${idx}] ${step.action}${sel ? ` ${sel}` : ''}`);
  try {
    if (step.waitFor) {
      if (step.waitFor === 'networkidle') {
        await page.waitForLoadState('networkidle', { timeout: step.timeout ?? 5000 }).catch(() => {});
      } else {
        await page.locator(resolveVars(step.waitFor)).first().waitFor({ state: 'visible', timeout: step.timeout ?? 5000 });
      }
    }
    if (sel && ['click', 'type', 'fill', 'clear', 'select', 'hover', 'zoom', 'check', 'uncheck', 'clickResponse'].includes(step.action)) {
      const locator = page.locator(sel).first();
      await locator.waitFor({ state: 'attached', timeout: step.timeout ?? 8000 });
      // demo-video patches testreel 0.2.0 to do this before selector actions. Mirror
      // that behavior here so the dry run and final render use the same framing.
      await locator.scrollIntoViewIfNeeded();
      await locator.waitFor({ state: 'visible', timeout: step.timeout ?? 8000 });
    }
    switch (step.action) {
      case 'wait':
        // capped so a dry run stays fast; long enough to cover typical multi-second AI-latency waits.
        await page.waitForTimeout(Math.min(step.ms ?? 1000, 13000));
        break;
      case 'click': {
        // testreel's live click does NOT use .first() - an ambiguous selector is a hard
        // "strict mode violation" there, not a silent first-match. Surface that here too,
        // rather than only discovering it during the expensive live render.
        const matchCount = await page.locator(sel).count().catch(() => 1);
        if (matchCount > 1) {
          issues.push(`[${label}#${idx}] selector matches ${matchCount} elements, not 1 - testreel's live click ` +
            `will throw "strict mode violation" here (this dry run used .first() and kept going, which can hide ` +
            'this). Likely a trigger/submit text collision or a class selector matching an ancestor - see reference.md.');
        }
        await page.locator(sel).first().click({ timeout: step.timeout ?? 8000 });
        break;
      }
      case 'clickResponse': {
        const responsePromise = page.waitForResponse(
          (response) => response.url().includes(resolveVars(step.urlPattern)) &&
            (!step.method || response.request().method() === step.method),
          { timeout: step.timeout ?? 10000 },
        );
        const [, response] = await Promise.all([
          page.locator(sel).first().click({ timeout: step.timeout ?? 8000 }),
          responsePromise,
        ]);
        if (step.status !== undefined && response.status() !== step.status) {
          throw new Error(`response status ${response.status()} did not equal ${step.status}`);
        }
        break;
      }
      case 'type':
        await page.locator(sel).first().pressSequentially(resolveVars(step.text), { delay: 5 });
        break;
      case 'fill':
        await page.locator(sel).first().fill(resolveVars(step.text));
        break;
      case 'upload': {
        const input = page.locator(sel).first();
        await input.waitFor({ state: 'attached', timeout: step.timeout ?? 8000 });
        if (step.visualSelector) {
          const visual = page.locator(resolveVars(step.visualSelector)).first();
          await visual.waitFor({ state: 'visible', timeout: step.timeout ?? 8000 });
          await visual.scrollIntoViewIfNeeded();
        }
        const files = Array.isArray(step.files)
          ? step.files.map(resolveVars)
          : resolveVars(step.files);
        await input.setInputFiles(files);
        break;
      }
      case 'check':
        await page.locator(sel).first().check();
        break;
      case 'uncheck':
        await page.locator(sel).first().uncheck();
        break;
      case 'assert': {
        const locator = page.locator(sel).first();
        if (step.kind === 'count') {
          const count = await page.locator(sel).count();
          if ((step.equals !== undefined && count !== step.equals) ||
              (step.min !== undefined && count < step.min) ||
              (step.max !== undefined && count > step.max)) {
            throw new Error(`count ${count} failed expected bounds`);
          }
        } else if (step.kind === 'hidden') {
          if (!(await locator.isHidden())) throw new Error('element is not hidden');
        } else {
          await locator.waitFor({ state: 'attached', timeout: step.timeout ?? 8000 });
          if (step.kind === 'text') {
            const actual = (await locator.innerText()).trim();
            if (step.equals !== undefined ? actual !== resolveVars(step.equals) : !actual.includes(resolveVars(step.text ?? ''))) {
              throw new Error(`text assertion failed; found ${JSON.stringify(actual)}`);
            }
          } else if (step.kind === 'visible' && !(await locator.isVisible())) throw new Error('element is not visible');
          else if (step.kind === 'enabled' && !(await locator.isEnabled())) throw new Error('element is not enabled');
          else if (step.kind === 'disabled' && await locator.isEnabled()) throw new Error('element is not disabled');
          else if (step.kind === 'checked' && !(await locator.isChecked())) throw new Error('element is not checked');
          else if (step.kind === 'unchecked' && await locator.isChecked()) throw new Error('element is checked');
          else if (step.kind === 'value' && (await locator.inputValue()) !== resolveVars(step.value)) {
            throw new Error('input value assertion failed');
          }
        }
        break;
      }
      case 'if': {
        const condition = step.condition;
        const locator = page.locator(resolveVars(condition.selector)).first();
        let matched = false;
        if (condition.state === 'attached') matched = (await locator.count()) > 0;
        else if (condition.state === 'checked') matched = await locator.isChecked().catch(() => false);
        else if (condition.state === 'enabled') matched = await locator.isEnabled().catch(() => false);
        else if (condition.state === 'text') {
          matched = (await locator.innerText().catch(() => '')).includes(resolveVars(condition.text ?? ''));
        } else matched = await locator.isVisible().catch(() => false);
        if (condition.not) matched = !matched;
        const nested = matched ? step.then : (step.else ?? []);
        for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
          await runStep(nested[nestedIndex], `${idx}.${nestedIndex}`, `${label}:if`);
        }
        break;
      }
      case 'clear':
        await page.locator(sel).first().fill('');
        break;
      case 'select':
        await page.locator(sel).first().selectOption(step.value);
        break;
      case 'hover':
        await page.locator(sel).first().hover();
        break;
      case 'keyboard':
        await page.keyboard.press(step.key);
        break;
      case 'navigate':
        // live testreel behavior: catches+warns on networkidle timeout rather than failing the recording.
        await page.goto(resolveVars(step.url), { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
        if (step.readySelector) {
          await page.locator(resolveVars(step.readySelector)).first().waitFor({
            state: 'visible', timeout: step.timeout ?? 10000,
          });
        }
        break;
      case 'waitForNetwork':
        await page.waitForResponse((r) => r.url().includes(step.urlPattern), { timeout: step.timeout ?? 10000 }).catch((e) => {
          issues.push(`[${label}#${idx}] waitForNetwork '${step.urlPattern}' timed out: ${e.message} - see reference.md, this has no crash protection in the live render either; prefer a plain "wait" for fast/local calls.`);
        });
        break;
      case 'scroll': {
        const before = await page.evaluate(() => ({ y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }));
        await page.evaluate(({ x, y }) => window.scrollBy(x ?? 0, y ?? 0), { x: step.x, y: step.y });
        await page.waitForTimeout(150);
        const wasAlreadyAtBottom = before.y >= before.max - 40;
        if (wasAlreadyAtBottom && (step.y ?? 0) > 0) {
          issues.push(`[${label}#${idx}] note: scroll y=${step.y} was a no-op, already at bottom before this step (harmless, but a candidate to trim)`);
        }
        break;
      }
      case 'zoom':
      case 'screenshot':
      case 'hideCursor':
      case 'showCursor':
        break; // no-ops for structural verification
      default:
        issues.push(`[${label}#${idx}] unknown action '${step.action}'`);
    }
  } catch (err) {
    issues.push(`[${label}#${idx}] FAILED action=${step.action} selector=${sel ?? ''}: ${err.message.split('\n')[0]}${roleSelectorHint(sel)}`);
  }
}

async function checkFraming(step, idx, label) {
  const checks = step.framingSelectors ?? [];
  const entries = Array.isArray(checks) ? checks : [checks];
  if (!entries.length) return;
  const viewport = page.viewportSize();
  if (!viewport) return;
  for (const raw of entries) {
    const config = typeof raw === 'string' ? { selector: raw } : raw;
    const selector = resolveVars(config.selector);
    const minVisibleRatio = config.minVisibleRatio ?? 0.85;
    try {
      const box = await page.locator(selector).first().boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        issues.push(`[${label}#${idx}] framing selector ${JSON.stringify(selector)} has no visible box`);
        continue;
      }
      const visibleWidth = Math.max(0, Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0));
      const visibleHeight = Math.max(0, Math.min(box.y + box.height, viewport.height) - Math.max(box.y, 0));
      const ratio = (visibleWidth * visibleHeight) / (box.width * box.height);
      if (ratio < minVisibleRatio) {
        issues.push(
          `[${label}#${idx}] framing selector ${JSON.stringify(selector)} is only ` +
          `${Math.round(ratio * 100)}% visible; requires ${Math.round(minVisibleRatio * 100)}%. ` +
          'Add or adjust an explicit scroll/selector action before narrating this section.',
        );
      }
    } catch (error) {
      issues.push(`[${label}#${idx}] framing selector ${JSON.stringify(selector)} failed: ${error.message.split('\n')[0]}`);
    }
  }
}

if (def.setup) {
  await page.goto(resolveVars(def.setup.url), { waitUntil: 'networkidle', timeout: 15000 });
  for (let i = 0; i < def.setup.steps.length; i++) await runStep(def.setup.steps[i], i, 'setup');
}

// 'networkidle' never resolves on pages with ongoing polling/diagnostics - 'load' + a fixed settle is more robust.
await page.goto(resolveVars(def.url), { waitUntil: 'load', timeout: 15000 }).catch((e) => issues.push(`initial navigate: ${e.message}`));
if (def.waitForSelector) {
  await page.locator(resolveVars(def.waitForSelector)).first().waitFor({ state: 'visible', timeout: 10000 })
    .catch((e) => issues.push(`initial waitForSelector: ${e.message.split('\n')[0]}`));
}
await page.waitForTimeout(1500);

// The primary signal: right BEFORE a tab-switching click (i.e. about to
// leave a section) and at the very end of the run, is there still unscrolled content?
// Mid-sequence "not yet at the bottom" is expected during a paced multi-step scroll -
// only a gap that's still open when we're about to move on / finish is a live bug.
//
// Note this only sees window-level scroll. `scroll` steps can't reach an element inside a
// fixed-height internal scroll container (e.g. a ScrollArea) - that's a separate, live
// limitation documented in reference.md, and this check won't flag it either way.
async function checkCoverage(label) {
  await trackPeak();
  if (peakMax > 60 && peakY < peakMax - 40) {
    issues.push(`[${label}] section never revealed ${Math.round(peakMax - peakY)}px of its content (best scrollY reached=${Math.round(peakY)}, max=${Math.round(peakMax)})`);
  }
  peakY = 0;
  peakMax = 0;
}

const evidenceResults = [];
async function captureEvidence(entry, evidenceIndex) {
  const selector = resolveVars(entry.selector);
  const locator = page.locator(selector);
  const count = await locator.count();
  let passed = count >= (entry.minCount ?? 1) && (entry.maxCount === undefined || count <= entry.maxCount);
  let detail = `count=${count}`;
  if (passed && entry.text) {
    const textValue = await locator.first().innerText().catch(() => '');
    passed = textValue.includes(resolveVars(entry.text));
    detail += ` text=${JSON.stringify(textValue.slice(0, 200))}`;
  }
  if (passed && entry.state === 'visible') passed = await locator.first().isVisible().catch(() => false);
  const evidenceDir = path.join(projectCacheDir(demoVideoHome()), name, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const safeName = entry.name.replace(/[^a-z0-9_-]/gi, '-');
  const screenshotPath = path.join(evidenceDir, `${String(evidenceIndex).padStart(2, '0')}-${safeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: entry.fullPage ?? false });
  evidenceResults.push({ index: evidenceIndex, name: entry.name, selector, passed, detail, screenshotPath });
  if (!passed) issues.push(`[evidence:${entry.name}] FAILED selector=${selector} ${detail}`);
}

for (let i = 0; i < def.steps.length; i++) {
  if (def.quality?.requireFullPageCoverage === true && def.steps[i].action === 'click') {
    await checkCoverage(`section-before-click#${i}`);
  }
  await runStep(def.steps[i], i, name);
  // testreel gives every non-wait step a live ~500ms pauseAfter by default - without it,
  // this script hits render-timing races the live render (with its natural per-step
  // overhead) wouldn't hit.
  if (def.steps[i].action !== 'wait') await page.waitForTimeout(def.steps[i].pauseAfter ?? 500);
  await checkFraming(def.steps[i], i, name);
  for (let evidenceIndex = 0; evidenceIndex < (def.evidence ?? []).length; evidenceIndex += 1) {
    if (def.evidence[evidenceIndex].afterStep === i) await captureEvidence(def.evidence[evidenceIndex], evidenceIndex);
  }
  await trackPeak();
}
if (def.quality?.requireFullPageCoverage === true) await checkCoverage('final-section');

for (let evidenceIndex = 0; evidenceIndex < (def.evidence ?? []).length; evidenceIndex += 1) {
  const entry = def.evidence[evidenceIndex];
  if (entry.afterStep === undefined || entry.afterStep === 'final') await captureEvidence(entry, evidenceIndex);
}

if (def.evidence?.length) {
  for (let evidenceIndex = 0; evidenceIndex < def.evidence.length; evidenceIndex += 1) {
    if (!evidenceResults.some((entry) => entry.index === evidenceIndex)) {
      const missing = def.evidence[evidenceIndex];
      evidenceResults.push({
        index: evidenceIndex,
        name: missing.name,
        selector: resolveVars(missing.selector),
        passed: false,
        detail: `afterStep ${JSON.stringify(missing.afterStep)} was never reached`,
        screenshotPath: null,
      });
      issues.push(`[evidence:${missing.name}] FAILED configured afterStep was never reached`);
    }
  }
  const reportPath = path.join(projectCacheDir(demoVideoHome()), name, 'evidence-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    definitionHash: crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'),
    createdAt: new Date().toISOString(),
    passed: evidenceResults.every((entry) => entry.passed),
    evidence: evidenceResults,
  }, null, 2));
  console.log(`evidence report: ${reportPath}`);
}

await context.close();
await browser.close();

console.log(`\n=== ${name} verification ===`);
if (issues.length === 0) {
  console.log('No issues found.');
} else {
  for (const issue of issues) console.log(' - ' + issue);
}
console.log(`(${issues.length} note(s))`);

const wroteData = def.steps.some((step) =>
  ((step.action === 'type' || step.action === 'fill') && step.text && !/^\$\{/.test(step.text)) ||
  step.action === 'upload'
);
if (wroteData) {
  console.log('\n⚠️  This recording writes values during the dry run.');
  console.log("   Clean up through the application's supported API before rendering when collisions are possible.");
}

if (issues.some((issue) => !issue.includes('note:'))) process.exitCode = 1;
