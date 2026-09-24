import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { parseSrt, formatSrt, formatAss } from './lib/captions.mjs';
import { editTimeline, retimeCues } from './lib/edit-timeline.mjs';
import { cachedNarration } from './lib/narration-cache.mjs';
import { synthesize, disposeSynthesizer } from './lib/synthesize.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-release-test-'));
const scripts = path.dirname(fileURLToPath(import.meta.url));

/** Run a bundled command inside the disposable test workspace. */
function runScript(name, ...args) {
  return execFileSync(process.execPath, [path.join(scripts, name), ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
}

/** Measure encoded stream duration for observable timing assertions. */
function duration(file) {
  return Number(execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file], { encoding: 'utf8' }));
}

/** Hash a compressed stream to verify copy paths and paired audio identity. */
function streamHash(file, kind) {
  return execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', `0:${kind}:0`, '-c', 'copy',
    '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim();
}

try {
  const cues = [{ start: 0.4, end: 1.6, text: 'Open the workspace.' },
    { start: 4, end: 5.6, text: 'Choose a contact.\nReview the result.' }];
  assert.deepEqual(parseSrt(formatSrt(cues)), cues);
  assert.deepEqual(parseSrt(''), []);
  assert.throws(() => parseSrt('1\n00:00:03,000 --> 00:00:02,000\nInvalid'));
  assert.throws(() => editTimeline(8, [[0, 9]]));
  assert.throws(() => editTimeline(8, [[0, 8]]));
  const timeline = editTimeline(8, [[7, 8], [2, 2.7], [2.5, 3]], 1.25);
  assert.ok(Math.abs(timeline.duration - 4.8) < 0.001);
  const mapped = retimeCues(cues, timeline);
  assert.equal(mapped[0].start, 0.32);
  assert.ok(Math.abs(mapped[1].start - 2.4) < 0.001);
  assert.throws(() => retimeCues(cues, editTimeline(8, [[0.6, 1]])));
  assert.ok(!formatAss([{ start: 0, end: 1, text: '{\\pos(1,1)}' }], 640, 360).includes('{\\pos'));

  const source = path.join(root, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  fs.writeFileSync(path.join(root, 'captions.srt'), formatSrt(cues));
  const spec = path.join(root, 'delivery.json');
  fs.writeFileSync(spec, JSON.stringify({ source: 'source.mp4', captions: 'captions.srt',
    outputPrefix: "viewer's edited demo", speed: 1.25, cuts: [[2, 3], [7, 8]] }));
  runScript('deliver-video.mjs', spec);
  const clean = path.join(root, "viewer's edited demo.mp4");
  const burned = path.join(root, "viewer's edited demo_subtitled.mp4");
  assert.ok(Math.abs(duration(clean) - 4.8) < 0.15);
  assert.ok(Math.abs(duration(clean) - duration(burned)) < 0.06);
  assert.equal(streamHash(clean, 'a'), streamHash(burned, 'a'));
  assert.notEqual(streamHash(clean, 'v'), streamHash(burned, 'v'));
  assert.deepEqual(parseSrt(fs.readFileSync(path.join(root, "viewer's edited demo.srt"), 'utf8')),
    parseSrt(formatSrt(mapped)));
  assert.throws(() => runScript('deliver-video.mjs', spec));

  const replacement = path.join(root, 'replacement.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '8', replacement]);
  fs.writeFileSync(spec, JSON.stringify({ source: 'source.mp4', audio: 'replacement.wav',
    outputPrefix: 'audio-only', burnCaptions: false }));
  runScript('deliver-video.mjs', spec);
  assert.equal(streamHash(source, 'v'), streamHash(path.join(root, 'audio-only.mp4'), 'v'));
  assert.notEqual(streamHash(source, 'a'), streamHash(path.join(root, 'audio-only.mp4'), 'a'));

  const silent = path.join(root, 'silent.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-i', source, '-an', '-c:v', 'copy', silent]);
  fs.writeFileSync(spec, JSON.stringify({ source: 'silent.mp4', outputPrefix: 'silent-edited', speed: 1.25 }));
  runScript('deliver-video.mjs', spec);
  assert.ok(Math.abs(duration(path.join(root, 'silent-edited.mp4')) - 6.4) < 0.15);

  const config = { engine: process.argv.includes('--with-piper') ? 'piper' : 'tiny-tts', speed: 1 };
  const clip = path.join(root, 'speech.wav');
  const text = 'Open the workspace and choose a contact to review the result.';
  const cache = path.join(root, 'clips');
  const first = await cachedNarration(text, clip, config, cache);
  assert.equal(first.cached, false);
  const second = await cachedNarration(text, clip, config, cache);
  assert.equal(second.cached, true);
  assert.equal(first.durationMs, second.durationMs);
  const faster = await cachedNarration(text, clip, { ...config, speed: 1.4 }, cache);
  assert.equal(faster.cached, false);
  assert.ok(faster.durationMs < first.durationMs * 0.9);
  await assert.rejects(synthesize('Invalid speed', clip, { speed: 0 }));
  await assert.rejects(synthesize('Invalid engine', clip, { engine: 'unsupported' }));
  if (process.argv.includes('--with-piper')) {
    await assert.rejects(synthesize('Unavailable model', clip, { piperModel: path.join(root, 'missing.onnx') }), /Piper narration failed/);
  }
  await disposeSynthesizer();

  const definition = path.join(root, 'offline.recording.json');
  const settings = { url: 'http://127.0.0.1:1', authRefresh: { url: 'http://127.0.0.1:1' },
    narrationConfig: config, quality: { encoder: 'libx264', trimLeadingLoading: false },
    steps: [{ action: 'wait', ms: 8000, narration: 'Open the workspace.' }] };
  fs.writeFileSync(definition, JSON.stringify(settings));
  runScript('generate-narration.mjs', definition);
  runScript('compile-video.mjs', definition, '--reuse-video', silent);
  assert.ok(fs.existsSync(path.join(root, 'demo', 'output', 'offline.mp4')));
  settings.steps[0].narration = 'Choose a contact.';
  fs.writeFileSync(definition, JSON.stringify(settings));
  assert.throws(() => runScript('compile-video.mjs', definition, '--reuse-video', silent), /stale/);
  settings.steps = [{ action: 'if', then: [{ action: 'wait', narration: 'A hidden branch.' }] }];
  fs.writeFileSync(definition, JSON.stringify(settings));
  assert.throws(() => runScript('generate-narration.mjs', definition), /branch narration/);
  console.log('[release-test] passed: paired delivery, ASS, cuts, speed, stream copy, audio replacement, narration cache, offline reuse, and stale audio rejection.');
} finally {
  await disposeSynthesizer();
  if (process.argv.includes('--keep-artifacts')) console.log(`[release-test] artifacts: ${root}`);
  else fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
