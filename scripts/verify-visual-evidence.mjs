import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { fileURLToPath } from 'node:url';
import { ensureOcrPython } from './lib/ocr-venv.mjs';

function normalized(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hashSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let equal = 0;
  for (let index = 0; index < left.length; index++) if (left[index] === right[index]) equal++;
  return equal / left.length;
}

function inspect(python, helper, image) {
  return JSON.parse(execFileSync(python, [helper, image], { encoding: 'utf8' }));
}

const [videoPath, checksPath, reportPathArg] = process.argv.slice(2);
if (!videoPath || !checksPath) {
  console.error('Usage: node verify-visual-evidence.mjs <video> <checks.json> [report.json]');
  process.exit(1);
}

const checks = JSON.parse(fs.readFileSync(checksPath, 'utf8'));
if (!Array.isArray(checks) || checks.length === 0) throw new Error('Visual checks must be a non-empty array.');
const reportPath = reportPathArg ?? path.join(path.dirname(checksPath), 'visual-evidence-report.json');
const captureDir = path.join(path.dirname(reportPath), `${path.basename(reportPath, '.json')}-frames`);
fs.mkdirSync(captureDir, { recursive: true });
const python = ensureOcrPython();
const helper = fileURLToPath(new URL('./ocr-frame.py', import.meta.url));
const results = [];

for (let index = 0; index < checks.length; index++) {
    const check = checks[index];
    const timestamp = Number(check.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error(`Check ${index} has an invalid timestamp.`);
    const safeName = String(check.name ?? 'check').replace(/[^a-z0-9_-]+/gi, '-');
    const frame = path.join(captureDir, `${String(index + 1).padStart(3, '0')}-${safeName}.png`);
    const filters = check.crop
      ? ['-vf', `crop=${check.crop.width}:${check.crop.height}:${check.crop.x}:${check.crop.y}`]
      : [];
    execFileSync(ffmpegStatic, ['-ss', timestamp.toFixed(3), '-i', videoPath, ...filters,
      '-frames:v', '1', '-y', frame], { stdio: 'ignore' });
    if (!fs.existsSync(frame)) throw new Error(`No frame exists at ${timestamp.toFixed(3)}s for ${check.name ?? index + 1}.`);
    const observed = inspect(python, helper, frame);
    const expectedText = Array.isArray(check.expectedText)
      ? check.expectedText
      : check.expectedText ? [check.expectedText] : [];
    const searchable = normalized(observed.text);
    const missingText = expectedText.filter((term) => !searchable.includes(normalized(term)));
    let referenceSimilarity = null;
    if (check.referenceImage) {
      const reference = inspect(python, helper, path.resolve(path.dirname(checksPath), check.referenceImage));
      referenceSimilarity = hashSimilarity(observed.hash, reference.hash);
    }
    const minimumSimilarity = check.minimumSimilarity ?? 0.86;
    const passed = missingText.length === 0
      && (referenceSimilarity === null || referenceSimilarity >= minimumSimilarity);
    results.push({
      name: check.name ?? `check-${index + 1}`,
      timestamp,
      frame,
      expectedText,
      observedText: observed.text,
      missingText,
      referenceSimilarity,
      minimumSimilarity: referenceSimilarity === null ? null : minimumSimilarity,
      passed,
    });
}

const failed = results.filter((result) => !result.passed);
fs.writeFileSync(reportPath, JSON.stringify({ video: path.resolve(videoPath), passed: failed.length === 0, results }, null, 2));
console.log(`[visual-evidence] ${results.length - failed.length}/${results.length} checks passed; report ${reportPath}`);
if (failed.length) process.exit(1);
