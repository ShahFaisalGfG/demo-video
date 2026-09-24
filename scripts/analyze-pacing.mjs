import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

function probeDuration(file) {
  return Number(execFileSync(ffprobeStatic.path, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' }).trim());
}

function parseTime(value) {
  const [hours, minutes, tail] = value.split(':');
  const [seconds, millis] = tail.split(',');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

function parseSrt(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/);
    const timing = lines.findIndex((line) => line.includes(' --> '));
    if (timing < 0) return [];
    const [start, end] = lines[timing].split(' --> ');
    return [{ start: parseTime(start), end: parseTime(end), text: lines.slice(timing + 1).join(' ') }];
  });
}

function meanDifference(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index++) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

function averageHash(frame) {
  const mean = frame.reduce((sum, value) => sum + value, 0) / frame.length;
  return Uint8Array.from(frame, (value) => value >= mean ? 1 : 0);
}

function hashDistance(left, right) {
  let difference = 0;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) difference++;
  return difference / left.length;
}

function groupStatic(differences, interval, threshold, minimumSeconds) {
  const groups = [];
  let start = null;
  for (let index = 0; index < differences.length; index++) {
    if (differences[index] <= threshold && start === null) start = index * interval;
    const ended = differences[index] > threshold || index === differences.length - 1;
    if (start !== null && ended) {
      const end = (differences[index] > threshold ? index + 1 : index + 2) * interval;
      if (end - start >= minimumSeconds) groups.push({ start, end, duration: end - start });
      start = null;
    }
  }
  return groups;
}

const positional = process.argv.slice(2).filter((value, index, all) => {
  if (index > 0 && all[index - 1].startsWith('--') && !['--strict'].includes(all[index - 1])) return false;
  return !value.startsWith('--');
});
const [videoPath, srtPath, reportPathArg] = positional;
if (!videoPath) {
  console.error('Usage: node analyze-pacing.mjs <video> [captions.srt] [report.json] [--strict]');
  process.exit(1);
}

const duration = probeDuration(videoPath);
const sampleSeconds = argument('--sample-seconds', 1);
const staticThreshold = argument('--static-threshold', 1.8);
const maxStaticSeconds = argument('--max-static-seconds', 8);
const sceneThreshold = argument('--scene-threshold', 24);
const minimumCutGap = argument('--minimum-cut-gap', 1.2);
const frameWidth = 32;
const frameHeight = 18;
const frameBytes = frameWidth * frameHeight;
const raw = execFileSync(ffmpegPath, [
  '-v', 'error', '-i', videoPath,
  '-vf', `fps=1/${sampleSeconds},scale=${frameWidth}:${frameHeight}:flags=area,format=gray`,
  '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
], { maxBuffer: 64 * 1024 * 1024 });
const frames = [];
for (let offset = 0; offset + frameBytes <= raw.length; offset += frameBytes) {
  frames.push(raw.subarray(offset, offset + frameBytes));
}
if (frames.length < 2) throw new Error('Pacing analysis needs at least two sampled frames.');

const differences = [];
for (let index = 1; index < frames.length; index++) differences.push(meanDifference(frames[index - 1], frames[index]));
const staticIntervals = groupStatic(differences, sampleSeconds, staticThreshold, maxStaticSeconds)
  .map((item) => ({ ...item, end: Math.min(item.end, duration) }));
const cuts = differences.flatMap((difference, index) => difference >= sceneThreshold
  ? [{ time: (index + 1) * sampleSeconds, difference }]
  : []);
const rushedCuts = cuts.slice(1).flatMap((cut, index) => {
  const gap = cut.time - cuts[index].time;
  return gap < minimumCutGap ? [{ previous: cuts[index].time, current: cut.time, gap }] : [];
});

const hashes = frames.map(averageHash);
const repeatedScreens = [];
const minimumRepeatGap = Math.max(10, sampleSeconds * 3);
for (let left = 0; left < hashes.length && repeatedScreens.length < 12; left++) {
  for (let right = left + Math.ceil(minimumRepeatGap / sampleSeconds); right < hashes.length; right++) {
    const similarity = 1 - hashDistance(hashes[left], hashes[right]);
    if (similarity >= 0.985) {
      repeatedScreens.push({ first: left * sampleSeconds, repeated: right * sampleSeconds, similarity });
      break;
    }
  }
}

const captions = parseSrt(srtPath);
function narratedCoverage(interval) {
  const narratedSeconds = captions.reduce((total, cue) =>
    total + Math.max(0, Math.min(interval.end, cue.end) - Math.max(interval.start, cue.start)), 0);
  return narratedSeconds / Math.max(0.1, interval.duration);
}
const classifiedStatic = staticIntervals.map((interval) => ({
  ...interval,
  narratedCoverage: captions.length ? narratedCoverage(interval) : null,
}));
const silentStaticIntervals = captions.length
  ? classifiedStatic.filter((interval) => interval.narratedCoverage < 0.25)
  : [];
const narratedStaticIntervals = captions.length
  ? classifiedStatic.filter((interval) => interval.narratedCoverage >= 0.25)
  : [];
const rushedCaptions = captions.flatMap((cue, index) => {
  const cueDuration = cue.end - cue.start;
  const words = cue.text.trim().split(/\s+/).filter(Boolean).length;
  const charactersPerSecond = cue.text.replace(/\s+/g, '').length / Math.max(0.1, cueDuration);
  const wordsPerSecond = words / Math.max(0.1, cueDuration);
  return cueDuration < 0.7 || charactersPerSecond > 21 || wordsPerSecond > 4.5
    ? [{ index: index + 1, start: cue.start, end: cue.end, charactersPerSecond, wordsPerSecond }]
    : [];
});
const midSpeechCuts = cuts.flatMap((cut) => captions.some((cue) =>
  cut.time > cue.start + 0.4 && cut.time < cue.end - 0.4)
  ? [{ time: cut.time }]
  : []);

const deductions = Math.min(60,
  silentStaticIntervals.length * 7 + narratedStaticIntervals.filter((item) => item.duration >= 18).length * 2 +
  rushedCuts.length * 8 + rushedCaptions.length * 3 + midSpeechCuts.length * 4 +
  Math.min(6, repeatedScreens.length));
const score = Math.max(0, 100 - deductions);
const report = {
  video: path.resolve(videoPath),
  captions: srtPath ? path.resolve(srtPath) : null,
  duration,
  sampleSeconds,
  sampledFrames: frames.length,
  score,
  passed: score >= 75 && rushedCaptions.length === 0,
  findings: {
    staticIntervals: classifiedStatic,
    silentStaticIntervals,
    narratedStaticIntervals,
    rushedCuts,
    repeatedScreens,
    rushedCaptions,
    midSpeechCuts,
  },
};
const reportPath = reportPathArg ?? path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}-pacing.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`[pacing] score ${score}/100 from ${frames.length} sparse frames; report ${reportPath}`);
if (process.argv.includes('--strict') && !report.passed) process.exit(1);
