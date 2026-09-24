// Joins multiple already-rendered per-part MP4s into one seamless final video via ffmpeg's
// concat demuxer (stream copy, no re-encode - fast and lossless). Intended for the
// "one video, internally split into __partN recordings to dodge the long-session
// degradation issue" workflow described in SKILL.md Step 4/6 - NOT for combining
// separate deliverable videos, which should stay as separate files.
//
// Stream-copy concat requires every part to share identical codec, resolution, and audio
// parameters - parts rendered from recording.jsons with matching outputSize/chrome/
// background/viewport/cursor config satisfy this by construction (see reference.md). This
// script probes every part with ffprobe first and refuses to merge (clear error, no output
// file written) rather than silently producing a corrupted or desynced result if they don't
// match - a mismatch here almost always means a __partN recording.json's header config was
// hand-edited and drifted from the others, not a transient ffmpeg issue.
//
// Usage: node ~/.demo_video/scripts/merge-videos.mjs demo/output/<name>.mp4 part1.mp4 part2.mp4 [...more parts, in order]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { findBlankSegments, formatTimestamp } from './lib/video-quality.mjs';

const ffprobePath = ffprobeStatic.path;

const [outputPath, ...parts] = process.argv.slice(2);
if (!outputPath || parts.length < 2) {
  console.error('Usage: node merge-videos.mjs <output.mp4> <part1.mp4> <part2.mp4> [...more parts, in order]');
  process.exit(1);
}

for (const p of parts) {
  if (!fs.existsSync(p)) {
    console.error(`Part not found: ${p}`);
    process.exit(1);
  }
}

function probe(file) {
  const raw = execFileSync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels',
    '-of', 'json',
    file,
  ], { encoding: 'utf-8' });
  return JSON.parse(raw).streams;
}

const signatures = parts.map((p) => {
  const streams = probe(p);
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    file: p,
    key: JSON.stringify({
      vCodec: video?.codec_name, w: video?.width, h: video?.height,
      aCodec: audio?.codec_name, rate: audio?.sample_rate, ch: audio?.channels,
    }),
  };
});

const distinct = new Set(signatures.map((s) => s.key));
if (distinct.size > 1) {
  console.error('Parts do not share identical codec/resolution/audio parameters - a stream-copy concat would produce a broken or desynced file. Mismatch:');
  for (const s of signatures) console.error(`  ${s.file}: ${s.key}`);
  console.error('Check each part\'s recording.json for identical outputSize/chrome/background/viewport/cursor config, re-render whichever drifted, then retry.');
  process.exit(1);
}

const listPath = path.join(path.dirname(outputPath) || '.', `.concat-list-${process.pid}.txt`);
const listContent = parts
  .map((p) => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
  .join('\n');
fs.writeFileSync(listPath, listContent);

try {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  execFileSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath], { stdio: 'inherit' });
  const blankSegments = findBlankSegments(outputPath, path.dirname(outputPath), { minimumMs: 2000 });
  if (blankSegments.length) {
    const summary = blankSegments
      .map((segment) => `${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}`)
      .join(', ');
    throw new Error(
      `Merged video contains ${blankSegments.length} blank/loading interval(s) of at least two seconds: ${summary}. ` +
      'Trim leading loads in each part and split route-changing navigate steps into separate parts before delivery.',
    );
  }
  console.log(`merged ${parts.length} part(s) into ${outputPath}`);
} finally {
  fs.rmSync(listPath, { force: true });
}
