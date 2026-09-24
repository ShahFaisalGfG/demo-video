import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function resolveVars(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, variable) => process.env[variable] ?? '');
}

async function runAuthStep(page, step) {
  const selector = step.selector ? resolveVars(step.selector) : null;
  switch (step.action) {
    case 'fill':
      await page.locator(selector).fill(resolveVars(step.text));
      break;
    case 'click':
      await page.locator(selector).click();
      break;
    case 'check':
      await page.locator(selector).check();
      break;
    case 'uncheck':
      await page.locator(selector).uncheck();
      break;
    case 'keyboard':
      await page.keyboard.press(step.key);
      break;
    case 'wait':
      await page.waitForTimeout(step.ms ?? 1000);
      break;
    default:
      throw new Error(`authRefresh does not support action ${step.action}.`);
  }
}

async function stateWorks(definition, statePath, browser) {
  if (!fs.existsSync(statePath)) return false;
  try {
    JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return false;
  }
  const maxAgeMinutes = definition.authRefresh.maxAgeMinutes ?? 45;
  const ageMs = Date.now() - fs.statSync(statePath).mtimeMs;
  if (ageMs > maxAgeMinutes * 60_000) return false;
  let context;
  try {
    context = await browser.newContext({
      viewport: definition.viewport,
      colorScheme: definition.colorScheme,
      storageState: statePath,
      extraHTTPHeaders: definition.headers,
    });
    const page = await context.newPage();
    await page.goto(resolveVars(definition.url), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const selector = definition.authRefresh.validateSelector ?? definition.waitForSelector;
    if (selector) {
      await page.locator(resolveVars(selector)).first().waitFor({ state: 'visible', timeout: 8000 });
    }
    if (definition.authRefresh.rejectUrlPattern && new RegExp(definition.authRefresh.rejectUrlPattern).test(page.url())) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    await context?.close();
  }
}

export async function ensureAuthState(definition) {
  if (!definition.authRefresh) return { refreshed: false };
  const stateValue = resolveVars(definition.authRefresh.storageState ?? definition.storageState ?? '');
  if (!stateValue) throw new Error('authRefresh requires storageState on the root or authRefresh block.');
  const statePath = path.resolve(stateValue);
  const browser = await chromium.launch({ headless: true });
  try {
    if (await stateWorks(definition, statePath, browser)) {
      console.log(`[auth-refresh] existing state is valid: ${statePath}`);
      return { refreshed: false, statePath };
    }
    const context = await browser.newContext({
      viewport: definition.viewport,
      colorScheme: definition.colorScheme,
      extraHTTPHeaders: definition.authRefresh.headers ?? definition.headers,
    });
    try {
      if (definition.authRefresh.cookies?.length) await context.addCookies(definition.authRefresh.cookies);
      const page = await context.newPage();
      await page.goto(resolveVars(definition.authRefresh.url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      for (const step of definition.authRefresh.steps ?? []) await runAuthStep(page, step);
      if (definition.authRefresh.readyUrlPattern) {
        await page.waitForURL(new RegExp(definition.authRefresh.readyUrlPattern), { timeout: 30_000 });
      }
      if (definition.authRefresh.readySelector) {
        await page.locator(resolveVars(definition.authRefresh.readySelector)).first().waitFor({
          state: 'visible', timeout: 15_000,
        });
      }
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      await context.storageState({ path: statePath });
      console.log(`[auth-refresh] refreshed ${statePath}`);
      return { refreshed: true, statePath };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
