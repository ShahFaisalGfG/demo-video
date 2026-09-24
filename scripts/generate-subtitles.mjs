// Builds one SRT from the measured narration manifests and final compiled durations of
// ordered recording parts.
//
// Usage: node ~/.demo_video/scripts/generate-subtitles.mjs demo/output/<name>.srt part1.recording.json [...parts]

import fs from 'node:fs';
import path from 'node:path';
import { demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';

const [outputPath, ...recordingPaths] = process.argv.slice(2);
if (!outputPath || !recordingPaths.length) {
  console.error('Usage: node generate-subtitles.mjs <output.srt> <part1.recording.json> [...parts in merge order]');
  process.exit(1);
}

function srtTime(ms) {
  const value = Math.max(0, Math.round(ms));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

const cacheRoot = projectCacheDir(demoVideoHome());
const cues = [];
let partOffsetMs = 0;
for (const recordingPath of recordingPaths) {
  const name = path.basename(recordingPath).replace(/\.recording\.json$/, '');
  const cacheDir = path.join(cacheRoot, name);
  const { manifest } = JSON.parse(fs.readFileSync(path.join(cacheDir, 'narration-manifest.json'), 'utf-8'));
  const timing = JSON.parse(fs.readFileSync(path.join(cacheDir, 'timing.json'), 'utf-8'));
  let cursorMs = 0;
  for (const entry of manifest) {
    const cueStart = cursorMs + (entry.leadSilenceMs ?? 0);
    if (entry.narrated && entry.text) {
      const startMs = partOffsetMs + Math.max(0, cueStart - timing.audioTrimMs);
      const endMs = partOffsetMs + Math.max(0, cueStart + entry.durationMs - timing.audioTrimMs);
      cues.push({ startMs, endMs, text: entry.text });
    }
    cursorMs += (entry.leadSilenceMs ?? 0) + (entry.durationMs ?? 0) + (entry.trailSilenceMs ?? 0);
  }
  partOffsetMs += timing.finalDurationMs;
}

for (let index = 0; index < cues.length; index++) {
  if (cues[index].endMs < cues[index].startMs) throw new Error(`Cue ${index + 1} ends before it starts.`);
  if (index > 0 && cues[index].startMs < cues[index - 1].endMs) {
    throw new Error(`Cue ${index + 1} overlaps cue ${index}.`);
  }
}

const body = cues.map((cue, index) =>
  `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}`,
).join('\n\n') + '\n';
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, body);
console.log(`wrote ${cues.length} cue(s) to ${outputPath}; final cue ends at ${srtTime(cues.at(-1)?.endMs ?? 0)}`);
