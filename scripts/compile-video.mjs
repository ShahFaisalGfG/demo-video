// Step 2 of the demo video pipeline.
//
// 1. Runs testreel against the *resolved* recording definition (produced by
//    generate-narration.mjs) to get a polished, cursor-animated, silent MP4.
// 2. Rebuilds the narration audio track by concatenating each narrated clip
//    with silence gaps sized from the manifest, so the track's timeline
//    matches the video's step-by-step timeline.
// 3. Compares the two durations. If either is shorter than the other, pads
//    it (freezes the last video frame / adds trailing silence) instead of
//    truncating. A demo video should never cut off mid-sentence or mid-frame.
// 4. Muxes the two into the final MP4.
//
// Usage: node ~/.demo_video/scripts/compile-video.mjs demo/<name>.recording.json
// Browser resolution is configured before Playwright is loaded so the same
// command works in PowerShell, cmd, Bash, and agent-owned terminals.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { demoVideoHome, projectCacheDir, browsersDir } from './lib/npm-env.mjs';
import { detectLeadingLoadingMs, findBlankSegments, formatTimestamp } from './lib/video-quality.mjs';
import { selectEncoder } from './lib/encoder.mjs';
import { masterAudio } from './lib/audio-mastering.mjs';

const ffprobePath = ffprobeStatic.path;

const expectedBrowsers = browsersDir(demoVideoHome());
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? expectedBrowsers;
const { ensureAuthState } = await import('./lib/auth-refresh.mjs');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node compile-video.mjs demo/<name>.recording.json [--reuse-video <verified-silent-video>]');
  process.exit(1);
}
const reuseIndex = process.argv.indexOf('--reuse-video');
const reuseVideoPath = reuseIndex >= 0 ? process.argv[reuseIndex + 1] : null;
if (reuseIndex >= 0 && (!reuseVideoPath || !fs.existsSync(reuseVideoPath))) {
  console.error('--reuse-video requires an existing verified silent video path.');
  process.exit(1);
}

const name = path.basename(inputPath).replace(/\.recording\.json$/, '');
const cacheDir = path.join(projectCacheDir(demoVideoHome()), name);
const resolvedPath = path.join(cacheDir, 'recording.resolved.json');
const manifestPath = path.join(cacheDir, 'narration-manifest.json');

if (!fs.existsSync(resolvedPath) || !fs.existsSync(manifestPath)) {
  console.error(`Missing ${resolvedPath}. Run generate-narration.mjs on ${inputPath} first.`);
  process.exit(1);
}

const resolvedDef = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
const { manifest, definitionHash: narrationHash } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
if (narrationHash !== sourceHash) {
  throw new Error('Narration is stale or from an older pipeline. Run generate-narration.mjs for this definition again.');
}
const desktopCapture = resolvedDef.capture?.type === 'desktop';
if (resolvedDef.quality?.requireEvidence === true) {
  const reportPath = path.join(cacheDir, 'evidence-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Evidence is required but ${reportPath} is missing. Run verify-steps.mjs first.`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const definitionHash = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
  if (!report.passed || report.definitionHash !== definitionHash) {
    throw new Error('Evidence report failed or belongs to a different recording definition. Run verification again.');
  }
  console.log(`[${name}] evidence report passed (${report.evidence.length} item(s)).`);
}

function visualDefinition(value) {
  if (Array.isArray(value)) return value.map(visualDefinition);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'narration' || key === 'narrationConfig') continue;
    output[key] = visualDefinition(child);
  }
  return output;
}

let automaticReusePath = null;
let visualCachePath = null;
if (!reuseVideoPath && resolvedDef.quality?.cacheVisualCapture === true) {
  const visualHash = crypto.createHash('sha256')
    .update(JSON.stringify(visualDefinition(resolvedDef)))
    .digest('hex')
    .slice(0, 20);
  visualCachePath = path.join(cacheDir, 'visual-cache', `${visualHash}.mp4`);
  if (fs.existsSync(visualCachePath)) {
    try {
      if (probeMs(visualCachePath) > 0) automaticReusePath = visualCachePath;
    } catch {
      console.warn(`[${name}] cached visual capture is unreadable; recording a fresh copy.`);
    }
  }
}

function probeMs(file) {
  const out = execFileSync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]).toString().trim();
  return Math.round(parseFloat(out) * 1000);
}

function leadingNarrationSilenceMs(entries) {
  let total = 0;
  for (const entry of entries) {
    total += entry.leadSilenceMs ?? 0;
    if (entry.narrated) break;
    total += (entry.durationMs ?? 0) + (entry.trailSilenceMs ?? 0);
  }
  return total;
}

function resolveVars(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, variable) => process.env[variable] ?? '');
}

// Preflight checks the target URL before
// spending time launching a browser against it. ---
const targetUrl = resolveVars(resolvedDef.url);
if (!desktopCapture && !reuseVideoPath && !automaticReusePath) {
  await ensureAuthState(resolvedDef);
  try {
    const res = await fetch(targetUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`[${name}] Could not reach ${targetUrl} (${err.message}).`);
    console.error('Start the dev server (or set the correct DEMO_BASE_URL) before recording.');
    process.exit(1);
  }
}

// 1. Record the silent, cursor-animated video.
// Legacy testreel has no per-step failure hook in its public API. A step whose pre-check
// throws (e.g. a selector that never matches) is logged to stdout as "step N failed: ..."
// and then SKIPPED, and the recording still "succeeds" and produces a video missing
// whatever that step should have shown. Tap stdout during the call so a broken selector
// is a loud, actionable warning instead of a video that looks fine until someone watches
// it closely (see reference.md "Notes & caveats").
const stepFailures = [];
const readinessFailures = [];
const stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  const m = text.match(/step (\d+) failed: (.+)/);
  if (m) stepFailures.push({ step: m[1], message: m[2].split('\n')[0] });
  const ready = text.match(/warning: waitForSelector '([^']+)' failed: (.+)/);
  if (ready) readinessFailures.push({ selector: ready[1], message: ready[2].split('\n')[0] });
  return stdoutWrite(chunk, ...args);
};

console.log(reuseVideoPath
  ? `[${name}] reusing previously verified silent video ${reuseVideoPath}`
  : automaticReusePath
    ? `[${name}] reusing cached visual capture ${automaticReusePath}`
  : `[${name}] recording with ${desktopCapture ? 'native desktop adapter' :
    resolvedDef.quality?.recorder === 'testreel-legacy' ? 'legacy testreel' : 'owned browser adapter'}...`);
const videoOutDir = path.join(cacheDir, 'video');
let videoPath = reuseVideoPath ? path.resolve(reuseVideoPath) : automaticReusePath;
const recordedFresh = !videoPath;
try {
  if (!videoPath) {
    if (desktopCapture) {
      const { recordDesktop } = await import('./lib/desktop-recorder.mjs');
      ({ video: videoPath } = await recordDesktop(resolvedPath, path.join(videoOutDir, `${name}-desktop.mp4`)));
    } else if (resolvedDef.quality?.recorder === 'testreel-legacy') {
      const { record } = await import('testreel');
      ({ video: videoPath } = await record(resolvedPath, { outputDir: videoOutDir }));
    } else {
      const { recordDefinition } = await import('./lib/recorder-adapter.mjs');
      ({ video: videoPath } = await recordDefinition(resolvedPath, { outputDir: videoOutDir }));
    }
  }
} catch (err) {
  process.stdout.write = stdoutWrite;
  // The recorder aborts on the first step that throws. There is no
  // partial output and no per-step recovery hook exposed by its RecordOptions API. The
  // most common cause is a "waitForNetwork" step whose matching response already
  // completed before the listener attached (see the warning generate-narration.mjs prints
  // for every waitForNetwork step); the next most common is a stale/incorrect selector.
  console.error(`[${name}] ✘ recorder aborted: ${err.message}`);
  if (/waitForResponse|waitForNetwork/i.test(err.message)) {
    console.error(
      `[${name}] This looks like a "waitForNetwork" race. The response likely resolved before the ` +
      'listener attached. Replace that step with a plain "wait" (generous fixed duration) and re-run.',
    );
  } else if (/Timeout.*exceeded/i.test(err.message)) {
    console.error(
      `[${name}] This looks like a selector that never became actionable. Re-check it against the live ` +
      'app (never guess selectors) and consider adding an explicit "timeout" on that step.',
    );
  }
  process.exit(1);
}
process.stdout.write = stdoutWrite;
console.log(`[${name}] ${reuseVideoPath || automaticReusePath ? 'using' : 'recorded'} ${videoPath}`);
if (readinessFailures.length) {
  for (const failure of readinessFailures) {
    console.error(`[${name}] ✘ initial ready selector '${failure.selector}' failed: ${failure.message}`);
  }
  console.error(`[${name}] Refusing to mux a recording whose target page never became ready. Refresh authentication state or fix the selector, then re-run.`);
  process.exit(1);
}
if (stepFailures.length) {
  console.warn(`[${name}] ⚠️  ${stepFailures.length} legacy step(s) failed and were skipped:`);
  for (const f of stepFailures) console.warn(`   step ${f.step}: ${f.message}`);
  console.warn(`[${name}] Fix the legacy recording definition and run it again. Prefer the owned adapter for strict action failures.`);
  console.error(`[${name}] Refusing to mux a recording with skipped actions.`);
  process.exit(1);
}

// 2. Rebuild the narration track from the manifest.
const silenceDir = path.join(cacheDir, 'silence');
fs.mkdirSync(silenceDir, { recursive: true });

function probeSampleRate(file) {
  return execFileSync(ffprobePath, [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate',
    '-of', 'csv=p=0', file,
  ]).toString().trim() || '44100';
}

const firstClip = manifest.find((m) => m.narrated)?.audioPath;
const sampleRate = firstClip ? probeSampleRate(firstClip) : '44100';

let silenceCount = 0;
function makeSilence(ms) {
  if (ms <= 0) return null;
  const file = path.join(silenceDir, `silence-${silenceCount++}.wav`);
  execFileSync(ffmpegPath, [
    '-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`,
    '-t', (ms / 1000).toFixed(3),
    '-ar', sampleRate, '-ac', '1',
    '-y', file,
  ], { stdio: 'ignore' });
  return file;
}

const concatEntries = [];
for (const entry of manifest) {
  const lead = makeSilence(entry.leadSilenceMs);
  if (lead) concatEntries.push(lead);
  if (entry.narrated) concatEntries.push(entry.audioPath);
  const trail = makeSilence(entry.trailSilenceMs);
  if (trail) concatEntries.push(trail);
}

const listFile = path.join(cacheDir, 'concat-list.txt');
fs.writeFileSync(listFile, concatEntries.map((f) => `file '${path.resolve(f)}'`).join('\n'));

const trackPath = path.join(cacheDir, 'narration-track.wav');
execFileSync(ffmpegPath, [
  '-f', 'concat', '-safe', '0', '-i', listFile,
  '-ar', sampleRate, '-ac', '1',
  '-y', trackPath,
], { stdio: 'ignore' });

const narrationCfg = resolvedDef.narrationConfig ?? {};
const masteredTrackPath = path.join(cacheDir, 'narration-mastered.wav');
const audioMasteringEnabled = narrationCfg.audioMastering !== false;
if (audioMasteringEnabled) {
  masterAudio(trackPath, masteredTrackPath, sampleRate, narrationCfg);
  console.log(`[${name}] narration mastering applied.`);
}
const finalTrackPath = audioMasteringEnabled ? masteredTrackPath : trackPath;

// --- 3 & 4. Remove captured startup loading, compare durations, pad, and mux. ---
// Playwright starts recording when the browser context is created, before the target page
// finishes its initial navigation. testreel waits for the page before executing step 1, but
// those earlier blank/spinner frames remain in the raw video unless the pipeline removes
// them here. Detection uses central-region edge density rather than pixel color, so it works
// for both light and dark applications.
const qualityCfg = resolvedDef.quality ?? {};
const trimLeadingLoading = qualityCfg.trimLeadingLoading !== false;
const explicitTrimMs = qualityCfg.trimLeadingMs;
if (explicitTrimMs !== undefined && (!Number.isFinite(explicitTrimMs) || explicitTrimMs < 0)) {
  throw new Error('quality.trimLeadingMs must be a non-negative number when supplied.');
}
const detectedVideoTrimMs = explicitTrimMs !== undefined
  ? explicitTrimMs
  : trimLeadingLoading
    ? detectLeadingLoadingMs(videoPath, cacheDir, {
      minEdgeAverage: qualityCfg.contentEdgeAverage,
      stableContentMs: qualityCfg.stableContentMs,
      maxSeconds: qualityCfg.maxLeadingScanSeconds,
    })
    : 0;
const audioTrimMs = Math.min(detectedVideoTrimMs, leadingNarrationSilenceMs(manifest));
if (detectedVideoTrimMs > 0) {
  console.log(
    `[${name}] trimming ${(detectedVideoTrimMs / 1000).toFixed(2)}s of captured startup loading ` +
    `and ${(audioTrimMs / 1000).toFixed(2)}s of matching narration lead-in.`,
  );
}

const rawVideoMs = probeMs(videoPath);
const rawAudioMs = probeMs(finalTrackPath);
const videoMs = Math.max(1, rawVideoMs - detectedVideoTrimMs);
const audioMs = Math.max(1, rawAudioMs - audioTrimMs);
const targetMs = Math.max(videoMs, audioMs);
const driftMs = Math.abs(videoMs - audioMs);

console.log(`[${name}] video: ${videoMs}ms | narration: ${audioMs}ms | drift: ${driftMs}ms`);
if (driftMs > 500) {
  console.warn(
    `[${name}] ⚠️  video and narration differ by ${(driftMs / 1000).toFixed(1)}s. ` +
    `Consider tuning "actionOverheadMs" / "bufferMs" in narrationConfig for tighter sync.`,
  );
}

const videoPadSec = ((targetMs - videoMs) / 1000).toFixed(3);
const audioPadSec = ((targetMs - audioMs) / 1000).toFixed(3);

fs.mkdirSync('demo/output', { recursive: true });
const outPath = path.join('demo', 'output', `${name}.mp4`);
const encoder = selectEncoder(resolvedDef.quality?.encoder ?? 'auto');
console.log(`[${name}] final encoder: ${encoder.name}`);
const outputScale = resolvedDef.outputSize
  ? `,scale=${resolvedDef.outputSize.width}:${resolvedDef.outputSize.height}:force_original_aspect_ratio=decrease,` +
    `pad=${resolvedDef.outputSize.width}:${resolvedDef.outputSize.height}:(ow-iw)/2:(oh-ih)/2`
  : '';

execFileSync(ffmpegPath, [
  '-i', videoPath,
  '-i', finalTrackPath,
  '-filter_complex',
  `[0:v]trim=start=${(detectedVideoTrimMs / 1000).toFixed(3)},setpts=PTS-STARTPTS,` +
  `tpad=stop_mode=clone:stop_duration=${videoPadSec}${outputScale}[v];` +
  `[1:a]atrim=start=${(audioTrimMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,` +
  `apad=pad_dur=${audioPadSec}[a]`,
  '-map', '[v]', '-map', '[a]',
  ...encoder.args, '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
  '-y', outPath,
], { stdio: 'ignore' });

const allowedInternalBlankMs = qualityCfg.allowedInternalBlankMs ?? 2000;
const blankSegments = findBlankSegments(outPath, cacheDir, { minimumMs: allowedInternalBlankMs });
if (blankSegments.length) {
  const summary = blankSegments
    .map((segment) => `${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}`)
    .join(', ');
  console.error(
    `[${name}] ✘ video contains ${blankSegments.length} blank/loading interval(s) at least ` +
    `${allowedInternalBlankMs}ms long: ${summary}. Split route-changing navigate steps into ` +
    'separate recording parts or fix the readiness/framing steps before delivery.',
  );
  process.exit(1);
}

if (qualityCfg.visualEvidence) {
  const visualEvidencePath = path.resolve(path.dirname(path.resolve(inputPath)), qualityCfg.visualEvidence);
  const visualEvidenceReport = path.join(cacheDir, 'visual-evidence-report.json');
  const visualVerifier = fileURLToPath(new URL('./verify-visual-evidence.mjs', import.meta.url));
  execFileSync(process.execPath, [visualVerifier, outPath, visualEvidencePath, visualEvidenceReport], {
    stdio: 'inherit',
  });
}

if (qualityCfg.semanticEvidence) {
  const semanticEvidencePath = path.resolve(path.dirname(path.resolve(inputPath)), qualityCfg.semanticEvidence);
  const semanticReport = path.join(cacheDir, 'semantic-evidence-report.json');
  const semanticVerifier = fileURLToPath(new URL('./verify-semantic-evidence.mjs', import.meta.url));
  execFileSync(process.execPath, [semanticVerifier, outPath, semanticEvidencePath, semanticReport], {
    stdio: 'inherit',
  });
}

if (qualityCfg.pacingAnalysis === true) {
  const pacingReport = path.join(cacheDir, 'pacing-report.json');
  const pacingAnalyzer = fileURLToPath(new URL('./analyze-pacing.mjs', import.meta.url));
  const pacingArgs = [pacingAnalyzer, outPath, '', pacingReport];
  if (qualityCfg.pacingSampleSeconds) pacingArgs.push('--sample-seconds', String(qualityCfg.pacingSampleSeconds));
  if (qualityCfg.maxStaticSeconds) pacingArgs.push('--max-static-seconds', String(qualityCfg.maxStaticSeconds));
  execFileSync(process.execPath, pacingArgs, { stdio: 'inherit' });
}

if (recordedFresh && visualCachePath) {
  fs.mkdirSync(path.dirname(visualCachePath), { recursive: true });
  fs.copyFileSync(videoPath, visualCachePath);
  console.log(`[${name}] cached visual capture ${visualCachePath}`);
}

fs.writeFileSync(path.join(cacheDir, 'timing.json'), JSON.stringify({
  name,
  videoTrimMs: detectedVideoTrimMs,
  audioTrimMs,
  finalDurationMs: probeMs(outPath),
}, null, 2));

console.log(`[${name}] ✔ final video: ${outPath} (${(probeMs(outPath) / 1000).toFixed(1)}s), blank/loading QA passed`);
