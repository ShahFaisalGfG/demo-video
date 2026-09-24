// Final artifact QA. Verifies stream shape/duration and rejects long blank/loading
// intervals that selector checks and narration drift cannot detect.
//
// Usage: node ~/.demo_video/scripts/verify-video.mjs demo/output/<name>.mp4

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffprobeStatic from 'ffprobe-static';
import { demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';
import { findBlankSegments, formatTimestamp } from './lib/video-quality.mjs';

const videoPath = process.argv[2];
if (!videoPath || !fs.existsSync(videoPath)) {
  console.error('Usage: node verify-video.mjs demo/output/<name>.mp4');
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

console.log(JSON.stringify({
  file: path.resolve(videoPath),
  bytes: Number(probe.format.size),
  durationSeconds: Number(probe.format.duration),
  video: { codec: video?.codec_name, width: video?.width, height: video?.height, durationSeconds: Number(video?.duration) },
  audio: { codec: audio?.codec_name, sampleRate: audio?.sample_rate, channels: audio?.channels, durationSeconds: Number(audio?.duration) },
  blankSegments,
}, null, 2));

if (errors.length) {
  for (const error of errors) console.error(`✘ ${error}`);
  process.exit(1);
}
console.log('✔ stream and blank/loading QA passed');
