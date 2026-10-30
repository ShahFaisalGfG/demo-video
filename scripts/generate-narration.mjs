// Step 1 of the demo video pipeline.
//
// Reads a narration-annotated recording definition (e.g. demo/onboarding.recording.json),
// synthesizes a voice clip for every step that has a `narration` field, measures
// each clip's measured duration, and writes back a "resolved" definition whose
// `wait`/`pauseAfter` values are guaranteed to be at least as long as the
// narration that plays during them. This is the core fix over hand-guessed
// `waitForTimeout(3000)`-style pauses: the pause length is *derived from the
// actual audio*, not eyeballed.
//
// Usage: node ~/.demo_video/scripts/generate-narration.mjs demo/<name>.recording.json

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';
import { disposeSynthesizer, voiceLabel } from './lib/synthesize.mjs';
import { cachedNarration } from './lib/narration-cache.mjs';
import { prepareNarration } from './lib/narration-text.mjs';
import { selectVoice } from './lib/voice-selection.mjs';
import { HUMAN_REACH_EXTRA_MS, POINTER_ACTIONS, cursorSettings } from './lib/human-cursor.mjs';

const DEFAULT_PAUSE_AFTER = 500; // testreel's own documented default for non-wait steps

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node generate-narration.mjs demo/<name>.recording.json');
  process.exit(1);
}

const name = path.basename(inputPath).replace(/\.recording\.json$/, '');
// Cache lives in the isolated environment, namespaced per-project, never in
// the project itself. See npm-env.mjs.
const projectCache = projectCacheDir(demoVideoHome());
const cacheDir = path.join(projectCache, name);
const audioDir = path.join(cacheDir, 'audio');
const manifestPath = path.join(cacheDir, 'narration-manifest.json');
fs.mkdirSync(audioDir, { recursive: true });
// Clips are rewritten in place, so a run that fails midway must not leave the previous manifest pointing at them.
fs.rmSync(manifestPath, { force: true });

const def = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const definitionHash = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
function validateBranches(steps, nested = false) {
  for (const step of steps) {
    if (nested && (step.narration || step.spokenNarration)) {
      throw new Error('Place narration on top-level steps; branch narration is not supported.');
    }
    if (step.spokenNarration && !step.narration) throw new Error('spokenNarration needs the step\'s narration caption.');
    validateBranches(step.then ?? [], true);
    validateBranches(step.else ?? [], true);
  }
}
validateBranches(def.steps);
if (def.capture?.type === 'desktop') def.sourceDirectory = path.dirname(path.resolve(inputPath));

// testreel's `waitForNetwork` has no timeout safety net of its own (confirmed by reading
// testreel's source: it is a bare `await page.waitForResponse(...)`, uncaught). If the
// matching response already completed before this step's listener attaches, which is
// routine for fast local API calls (a local CRUD POST often resolves well under a second),
// the wait hangs until its timeout and then THROWS, aborting the entire recording with no
// partial video. Warn loudly here so a bad step is caught before spending render time on it.
for (const [i, step] of def.steps.entries()) {
  if (step.action === 'waitForNetwork') {
    console.warn(
      `[${name}] ⚠️  step ${i}: "waitForNetwork" on '${step.urlPattern}' can race in legacy testreel. ` +
      'if that response can resolve in well under a second (typical for a local CRUD call), it may complete ' +
      'before this step starts listening, and testreel will hang until timeout and then ABORT the whole render. ' +
      'Prefer a plain "wait" step with a generous fixed duration for fast/local calls; reserve "waitForNetwork" ' +
      'for calls you are confident are slow enough (e.g. multi-second AI-generation latency) that the race is unlikely.',
    );
  }
}

let narrationCfg = def.narrationConfig || {};
const voiceSelection = await selectVoice(
  narrationCfg,
  def.steps.filter((step) => step.narration).map((step) => step.narration),
  projectCache,
  path.dirname(path.resolve(inputPath)),
);
narrationCfg = voiceSelection.config;
def.narrationConfig = narrationCfg;
if (voiceSelection.report) {
  console.log(`[${name}] selected voice ${voiceSelection.report.selected} ` +
    `(${voiceSelection.report.mode}${voiceSelection.report.cached ? ', cached' : ''}).`);
}
const bufferMs = narrationCfg.bufferMs ?? 450;
const actionOverheadMs = narrationCfg.actionOverheadMs ?? 400;
const initialSilenceMs = Math.max(0, narrationCfg.initialSilenceMs ?? 0);
const finalSilenceMs = Math.max(0, narrationCfg.finalSilenceMs ?? 0);
const globalSpeed = def.speed ?? 1;
const desktop = def.capture?.type === 'desktop';
const desktopHuman = desktop && (def.capture?.motion ?? 'human') === 'human';
// A human desktop click reaches, settles, and presses (about 0.8 s) where a linear click is immediate.
const DESKTOP_REACH_EXTRA_MS = 400;
const reachActions = desktop ? ['move', 'click', 'doubleClick', 'drag', 'imageClick'] : [...POINTER_ACTIONS, 'upload'];
const humanReachMs = desktop ? (desktopHuman ? DESKTOP_REACH_EXTRA_MS : 0)
  : cursorSettings(def).human ? HUMAN_REACH_EXTRA_MS : 0;

// Rough estimate of how long a non-`wait` step's own animation takes, used
// only to decide how much *silent* lead-in to give a narration clip before it
// starts (see build in compile-video.mjs). Being slightly wrong here just
// shifts a clip a few hundred ms early or late within its own pause window.
// It never truncates audio, because the pause itself is sized from the measured
// measured clip duration, not off this estimate.
function estimateActionMs(step) {
  const reach = reachActions.includes(step.action) ? humanReachMs / globalSpeed : 0;
  return reach + stepActionMs(step);
}

function stepActionMs(step) {
  switch (step.action) {
    case 'wait':
      return step.ms ?? 1000;
    case 'type':
      if (desktop) {
        // Desktop typing uses `interval` in seconds; the human rhythm adds pauses after words and punctuation.
        const interval = step.interval ?? (desktopHuman ? 0.09 : 0.04);
        return (step.text?.length || 0) * interval * 1000 * (desktopHuman ? 1.15 : 1);
      }
      return ((step.text?.length || 0) * (step.delay ?? 80)) / globalSpeed;
    case 'scroll':
      return 600 / globalSpeed;
    case 'zoom':
      return (step.duration ?? 600) / globalSpeed;
    case 'click':
    case 'clickResponse':
    case 'check':
    case 'uncheck':
      return (step.zoom ? 2 * 600 : 0) / globalSpeed + actionOverheadMs;
    case 'assert':
      return 100 / globalSpeed;
    case 'if': {
      const estimateBranch = (branch = []) => branch.reduce(
        (total, nested) => total + estimateActionMs(nested) + (nested.action === 'wait' ? 0 : (nested.pauseAfter ?? 500)),
        0,
      );
      return Math.max(estimateBranch(step.then), estimateBranch(step.else));
    }
    default:
      return actionOverheadMs;
  }
}

const manifest = initialSilenceMs > 0
  ? [{ action: 'initial', narrated: false, leadSilenceMs: initialSilenceMs, trailSilenceMs: 0 }]
  : [];
let clipIndex = 0;
let reusedClips = 0;

for (const step of def.steps) {
  const entry = { action: step.action, narrated: false, leadSilenceMs: 0, trailSilenceMs: 0 };

  if (step.narration) {
    const prepared = prepareNarration(step.narration, narrationCfg, path.dirname(path.resolve(inputPath)),
      step.spokenNarration);
    for (const warning of prepared.warnings) {
      console.warn(`[${name}] narration step ${clipIndex}: ${warning}`);
    }
    const clipPath = path.join(audioDir, `step-${String(clipIndex).padStart(3, '0')}.wav`);
    const audio = await cachedNarration(prepared.spokenText, clipPath, narrationCfg,
      path.join(projectCache, 'narration-clips'));
    const durationMs = audio.durationMs;
    if (audio.cached) reusedClips++;
    entry.engine = audio.engine;
    entry.voice = voiceLabel(audio.engine, narrationCfg);
    const requiredMs = durationMs + bufferMs;

    if (step.action === 'wait') {
      step.ms = Math.max(step.ms ?? 1000, requiredMs);
      entry.trailSilenceMs = step.ms - durationMs;
    } else {
      step.pauseAfter = Math.max(step.pauseAfter ?? DEFAULT_PAUSE_AFTER, requiredMs);
      entry.leadSilenceMs = estimateActionMs(step);
      entry.trailSilenceMs = step.pauseAfter - durationMs;
    }

    entry.narrated = true;
    entry.audioPath = clipPath;
    entry.durationMs = durationMs;
    entry.text = prepared.displayText;
    entry.spokenText = prepared.spokenText;
    clipIndex++;
  } else {
    entry.leadSilenceMs = step.action === 'wait'
      ? (step.ms ?? 1000)
      : estimateActionMs(step) + (step.pauseAfter ?? DEFAULT_PAUSE_AFTER);
  }

  manifest.push(entry);
}

if (finalSilenceMs > 0) {
  manifest.push({ action: 'final', narrated: false, leadSilenceMs: finalSilenceMs, trailSilenceMs: 0 });
}

await disposeSynthesizer();

const voices = [...new Set(manifest.filter((entry) => entry.narrated).map((entry) => `${entry.engine}/${entry.voice}`))];
if (voices.length > 1) {
  throw new Error(`Narration mixes voices (${voices.join(', ')}) because a fallback ran for only some clips. ` +
    'Repair the primary engine and run again, or set engine to the fallback so every clip uses one voice.');
}

const resolvedPath = path.join(cacheDir, 'recording.resolved.json');
fs.writeFileSync(resolvedPath, JSON.stringify(def, null, 2));
fs.writeFileSync(manifestPath, JSON.stringify({ name, definitionHash, manifest }, null, 2));

const totalMs = manifest.reduce((sum, e) => sum + e.leadSilenceMs + (e.durationMs || 0) + e.trailSilenceMs, 0);
console.log(`[${name}] prepared ${clipIndex} narrated step(s); reused ${reusedClips} unchanged clip(s).`);
console.log(`[${name}] estimated total timeline: ${(totalMs / 1000).toFixed(1)}s`);
console.log(`[${name}] wrote ${resolvedPath}`);
