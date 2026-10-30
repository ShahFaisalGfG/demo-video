// Final artifact QA. Verifies stream shape/duration and rejects long blank/loading
// intervals and single-frame flashes that selector checks and narration drift cannot
// detect. Frames that jump away and return within twelve frames are reported as
// warnings, or as errors with --strict.
//
// Usage: node ~/.demo_video/scripts/verify-video.mjs demo/output/<name>.mp4 [--strict]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffprobeStatic from 'ffprobe-static';
import { demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';
import { findBlankSegments, findFlashFrames, formatTimestamp } from './lib/video-quality.mjs';

const videoPath = process.argv[2];
const strict = process.argv.includes('--strict');
if (!videoPath || !fs.existsSync(videoPath)) {
  console.error('Usage: node verify-video.mjs demo/output/<name>.mp4 [--strict]');
  process.exit(1);
}

const raw = execFileSync(ffprobeStatic.path, [
  '-v', 'error',
  '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels,duration',
  '-of', 'json', videoPath,
], { encoding: 'utf-8' });
const probe = JSON.parse(raw);
const video = probe.streams.find((stream) => stream.codec_type === 'video');
const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
const errors = [];
if (video?.codec_name !== 'h264') errors.push(`expected H.264 video, found ${video?.codec_name ?? 'none'}`);
if (audio?.codec_name !== 'aac') errors.push(`expected AAC audio, found ${audio?.codec_name ?? 'none'}`);
const videoMs = Number(video?.duration ?? probe.format.duration) * 1000;
const audioMs = Number(audio?.duration ?? probe.format.duration) * 1000;
if (Math.abs(videoMs - audioMs) > 500) {
  errors.push(`video/audio stream duration differs by ${Math.round(Math.abs(videoMs - audioMs))}ms`);
}

const workDir = path.join(projectCacheDir(demoVideoHome()), 'final-video-qa');
const blankSegments = findBlankSegments(videoPath, workDir, { minimumMs: 2000 });
if (blankSegments.length) {
  errors.push(
    'blank/loading intervals: ' + blankSegments
      .map((segment) => `${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}`)
      .join(', '),
  );
}

const { flashes, glitches } = findFlashFrames(videoPath);
const times = (list) => list.map((ms) => formatTimestamp(ms)).join(', ');
if (flashes.length) errors.push(`single-frame flashes: ${times(flashes)}`);
if (glitches.length && strict) errors.push(`frames that jump away and return: ${times(glitches)}`);
else if (glitches.length) console.warn(`⚠ frames that jump away and return (review them): ${times(glitches)}`);

console.log(JSON.stringify({
  file: path.resolve(videoPath),
  bytes: Number(probe.format.size),
  durationSeconds: Number(probe.format.duration),
  video: { codec: video?.codec_name, width: video?.width, height: video?.height, durationSeconds: Number(video?.duration) },
  audio: { codec: audio?.codec_name, sampleRate: audio?.sample_rate, channels: audio?.channels, durationSeconds: Number(audio?.duration) },
  blankSegments,
  flashFramesMs: flashes,
  returningJumpsMs: glitches,
}, null, 2));

if (errors.length) {
  for (const error of errors) console.error(`✘ ${error}`);
  process.exit(1);
}
console.log('✔ stream, blank/loading, and flash QA passed');
