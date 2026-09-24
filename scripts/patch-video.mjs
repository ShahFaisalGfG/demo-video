import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { selectEncoder } from './lib/encoder.mjs';

const [inputPath, patchPath, outputPath, ...options] = process.argv.slice(2);
if (!inputPath || !patchPath || !outputPath) {
  console.error('Usage: node patch-video.mjs <input.mp4> <patches.json> <output.mp4> [--encoder auto]');
  process.exit(1);
}

function optionValue(name, fallback) {
  const index = options.indexOf(name);
  return index < 0 ? fallback : options[index + 1];
}

const config = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
const overlays = config.overlays ?? [];
if (!Array.isArray(overlays) || overlays.length === 0) throw new Error('patches.json requires a non-empty overlays array.');
for (const [index, overlay] of overlays.entries()) {
  if (!overlay.path || !fs.existsSync(overlay.path)) throw new Error(`Overlay ${index} file is missing.`);
  if (!Number.isFinite(overlay.start) || !Number.isFinite(overlay.end) || overlay.end <= overlay.start) {
    throw new Error(`Overlay ${index} requires numeric start/end with end greater than start.`);
  }
}

const duration = Number(execFileSync(ffprobeStatic.path, [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath,
]).toString().trim());
for (const overlay of overlays) {
  if (overlay.end > duration) throw new Error(`Overlay ending at ${overlay.end}s exceeds ${duration.toFixed(3)}s input.`);
}

const encoder = selectEncoder(optionValue('--encoder', config.encoder ?? 'auto'));
const args = ['-y', '-i', inputPath];
for (const overlay of overlays) args.push('-loop', '1', '-i', overlay.path);
let previous = '[0:v]';
const filters = [];
overlays.forEach((overlay, index) => {
  const output = index === overlays.length - 1 ? '[vout]' : `[v${index}]`;
  filters.push(
    `${previous}[${index + 1}:v]overlay=` +
    `x=${overlay.x ?? 0}:y=${overlay.y ?? 0}:enable='between(t,${overlay.start},${overlay.end})'${output}`,
  );
  previous = output;
});
args.push(
  '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '0:a?',
  ...encoder.args, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-t', duration.toFixed(6),
  '-movflags', '+faststart', outputPath,
);
console.log(`[patch-video] encoder=${encoder.name} overlays=${overlays.length}`);
execFileSync(ffmpegPath, args, { stdio: 'inherit' });
console.log(`[patch-video] wrote ${outputPath}`);
