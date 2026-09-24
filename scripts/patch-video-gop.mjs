import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { selectEncoder } from './lib/encoder.mjs';

function probe(args) {
  return execFileSync(ffprobeStatic.path, ['-v', 'error', ...args], { encoding: 'utf8' }).trim();
}

function duration(file) {
  return Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
}

function keyframes(file, total) {
  const output = probe(['-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file]);
  const values = output.split(/\r?\n/).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return [...new Set([0, ...values, total])];
}

function windowsFor(patches, keys, total) {
  const windows = patches.map((patch) => {
    const start = Number(patch.start);
    const end = Number(patch.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > total + 0.05) {
      throw new Error(`Invalid patch interval ${patch.start}-${patch.end}.`);
    }
    const left = keys.filter((value) => value <= start + 0.0001).at(-1) ?? 0;
    const right = keys.find((value) => value >= end - 0.0001) ?? total;
    return { start: left, end: right, patches: [patch] };
  }).sort((left, right) => left.start - right.start);
  const merged = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end + 0.001) {
      previous.end = Math.max(previous.end, window.end);
      previous.patches.push(...window.patches);
    } else {
      merged.push(window);
    }
  }
  return merged;
}

function copySegment(input, start, end, output) {
  execFileSync(ffmpegStatic, ['-ss', start.toFixed(6), '-i', input, '-t', (end - start).toFixed(6),
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
    '-reset_timestamps', '1', '-movflags', '+faststart', '-y', output], { stdio: 'ignore' });
}

function patchSegment(input, window, output, encoder) {
  const args = ['-ss', window.start.toFixed(6), '-i', input];
  for (const patch of window.patches) args.push('-loop', '1', '-i', path.resolve(patch.image));
  const filters = [];
  let current = '[0:v]';
  window.patches.forEach((patch, index) => {
    const imageLabel = `img${index}`;
    const outputLabel = `v${index}`;
    const scale = patch.width || patch.height
      ? `scale=${patch.width ?? -1}:${patch.height ?? -1}`
      : 'null';
    filters.push(`[${index + 1}:v]${scale}[${imageLabel}]`);
    const localStart = Math.max(0, Number(patch.start) - window.start);
    const localEnd = Math.min(window.end - window.start, Number(patch.end) - window.start);
    filters.push(`${current}[${imageLabel}]overlay=${patch.x ?? 0}:${patch.y ?? 0}:` +
      `enable='between(t,${localStart.toFixed(6)},${localEnd.toFixed(6)})'[${outputLabel}]`);
    current = `[${outputLabel}]`;
  });
  args.push('-t', (window.end - window.start).toFixed(6), '-filter_complex', filters.join(';'),
    '-map', current, '-map', '0:a?', ...encoder.args, '-pix_fmt', 'yuv420p', '-c:a', 'copy',
    '-reset_timestamps', '1', '-movflags', '+faststart', '-y', output);
  execFileSync(ffmpegStatic, args, { stdio: 'ignore' });
}

const [input, patchesPath, output, encoderPreference = 'auto'] = process.argv.slice(2);
if (!input || !patchesPath || !output) {
  console.error('Usage: node patch-video-gop.mjs <input.mp4> <patches.json> <output.mp4> [encoder]');
  process.exit(1);
}
const codec = probe(['-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', input]);
if (codec !== 'h264') throw new Error(`GOP patching requires H.264 input; received ${codec}.`);
const patches = JSON.parse(fs.readFileSync(patchesPath, 'utf8'));
if (!Array.isArray(patches) || patches.length === 0) throw new Error('Patches must be a non-empty array.');
const total = duration(input);
const keys = keyframes(input, total);
const windows = windowsFor(patches, keys, total);
const encoder = selectEncoder(encoderPreference);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-video-gop-'));
const segments = [];

try {
  let cursor = 0;
  let part = 0;
  for (const window of windows) {
    if (window.start > cursor + 0.001) {
      const outputPart = path.join(scratch, `${String(part++).padStart(3, '0')}-copy.mp4`);
      copySegment(input, cursor, window.start, outputPart);
      segments.push(outputPart);
    }
    const outputPart = path.join(scratch, `${String(part++).padStart(3, '0')}-patch.mp4`);
    patchSegment(input, window, outputPart, encoder);
    segments.push(outputPart);
    cursor = window.end;
  }
  if (cursor < total - 0.001) {
    const outputPart = path.join(scratch, `${String(part++).padStart(3, '0')}-copy.mp4`);
    copySegment(input, cursor, total, outputPart);
    segments.push(outputPart);
  }
  const concatPath = path.join(scratch, 'segments.txt');
  fs.writeFileSync(concatPath, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
  execFileSync(ffmpegStatic, ['-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy',
    '-t', total.toFixed(6), '-movflags', '+faststart', '-y', output], { stdio: 'ignore' });
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

const outputDuration = duration(output);
if (Math.abs(outputDuration - total) > 0.35) {
  throw new Error(`Patched duration drifted by ${Math.abs(outputDuration - total).toFixed(3)}s.`);
}
const reencodedSeconds = windows.reduce((sum, window) => sum + window.end - window.start, 0);
console.log(`[gop-patch] ${patches.length} overlay(s), ${windows.length} GOP window(s), ` +
  `${reencodedSeconds.toFixed(2)}s re-encoded with ${encoder.name}, ${(total - reencodedSeconds).toFixed(2)}s stream-copied.`);
