import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';
import { selectEncoder } from './lib/encoder.mjs';

const ffprobePath = ffprobeStatic.path;
const [inputVideo, inputSrt, outputVideo, outputSrt, ...options] = process.argv.slice(2);
if (!inputVideo || !inputSrt || !outputVideo || !outputSrt) {
  console.error(
    'Usage: node compact-silence.mjs <input.mp4> <input.srt> <output.mp4> <output.srt> ' +
    '[--silence-speed 4] [--minimum-gap-ms 500]',
  );
  process.exit(1);
}

function optionValue(name, fallback) {
  const index = options.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(options[index + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} requires a positive number.`);
  return value;
}

const silenceSpeed = optionValue('--silence-speed', 4);
const minimumGapSeconds = optionValue('--minimum-gap-ms', 500) / 1000;
const encoderIndex = options.indexOf('--encoder');
const encoder = selectEncoder(encoderIndex < 0 ? 'auto' : options[encoderIndex + 1]);

function parseTime(value) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function formatTime(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const wholeSeconds = Math.floor((millis % 60000) / 1000);
  const remainder = millis % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(wholeSeconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}

function parseSrt(contents) {
  return contents.trim().split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes(' --> '));
    if (timingIndex < 0) throw new Error(`SRT block has no timing line: ${block.slice(0, 80)}`);
    const [start, end] = lines[timingIndex].split(' --> ');
    return {
      index: lines[0],
      start: parseTime(start),
      end: parseTime(end),
      text: lines.slice(timingIndex + 1).join('\n'),
    };
  });
}

const cues = parseSrt(fs.readFileSync(inputSrt, 'utf8'));
const duration = Number(execFileSync(ffprobePath, [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputVideo,
]).toString().trim());
if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the input video duration.');

for (let index = 0; index < cues.length; index += 1) {
  const cue = cues[index];
  if (cue.start < 0 || cue.end <= cue.start || cue.end > duration + 0.1) {
    throw new Error(`Cue ${cue.index} lies outside the video timeline.`);
  }
  if (index > 0 && cue.start < cues[index - 1].end) {
    throw new Error(`Cue ${cue.index} overlaps cue ${cues[index - 1].index}.`);
  }
}

const segments = [];
let cursor = 0;
function addSegment(start, end, narrated) {
  if (end - start < 0.001) return;
  const sourceDuration = end - start;
  const outputDuration = narrated
    ? sourceDuration
    : Math.max(Math.min(sourceDuration, minimumGapSeconds), sourceDuration / silenceSpeed);
  segments.push({
    start,
    end,
    narrated,
    speed: sourceDuration / outputDuration,
    outputDuration,
  });
}

for (const cue of cues) {
  addSegment(cursor, cue.start, false);
  addSegment(cue.start, cue.end, true);
  cursor = cue.end;
}
addSegment(cursor, duration, false);

let outputCursor = 0;
for (const segment of segments) {
  segment.outputStart = outputCursor;
  outputCursor += segment.outputDuration;
  segment.outputEnd = outputCursor;
}

function mapTime(time) {
  const segment = segments.find((candidate) => time >= candidate.start - 0.0005 && time <= candidate.end + 0.0005);
  if (!segment) throw new Error(`No timeline segment contains ${time.toFixed(3)} seconds.`);
  return segment.outputStart + (time - segment.start) / segment.speed;
}

const rewritten = cues.map((cue, index) => [
  String(index + 1),
  `${formatTime(mapTime(cue.start))} --> ${formatTime(mapTime(cue.end))}`,
  cue.text,
].join('\n')).join('\n\n') + '\n';
fs.writeFileSync(outputSrt, rewritten, 'utf8');

const filterLines = [];
filterLines.push(`[0:v]split=${segments.length}${segments.map((_, i) => `[vs${i}]`).join('')}`);
filterLines.push(`[0:a]asplit=${segments.length}${segments.map((_, i) => `[as${i}]`).join('')}`);
segments.forEach((segment, index) => {
  const start = segment.start.toFixed(6);
  const end = segment.end.toFixed(6);
  const speed = segment.speed.toFixed(8);
  filterLines.push(`[vs${index}]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${speed}[v${index}]`);
  filterLines.push(`[as${index}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,atempo=${speed}[a${index}]`);
});
filterLines.push(
  `${segments.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`,
);

const cacheDir = projectCacheDir(demoVideoHome());
const filterPath = path.join(cacheDir, `compact-silence-${process.pid}.txt`);
fs.writeFileSync(filterPath, filterLines.join(';\n'), 'utf8');
try {
  execFileSync(ffmpegPath, [
    '-y', '-i', inputVideo,
    '-filter_complex_script', filterPath,
    '-map', '[vout]', '-map', '[aout]',
    ...encoder.args, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    outputVideo,
  ], { stdio: 'inherit' });
} finally {
  fs.rmSync(filterPath, { force: true });
}

console.log(
  `compacted ${duration.toFixed(1)}s to ${outputCursor.toFixed(1)}s ` +
  `(${segments.filter((segment) => !segment.narrated).length} silent interval(s) at up to ${silenceSpeed}x, ` +
  `encoder=${encoder.name})`,
);
