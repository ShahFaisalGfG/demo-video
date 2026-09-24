import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const DEFAULT_FPS = 4;
const DEFAULT_CONTENT_EDGE_AVERAGE = 1.5;
const DEFAULT_BLANK_EDGE_AVERAGE = 0.15;

function filterPath(file) {
  return path.resolve(file).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:').replace(/'/g, "\\'");
}

function parseStats(raw) {
  const records = [];
  const blockPattern = /frame:\d+.*?pts_time:(?<time>[0-9.]+)\r?\n(?<body>.*?)(?=frame:\d+|$)/gs;
  for (const match of raw.matchAll(blockPattern)) {
    const average = Number(match.groups.body.match(/YAVG=(?<value>[0-9.]+)/)?.groups?.value);
    if (Number.isFinite(average)) records.push({ time: Number(match.groups.time), edgeAverage: average });
  }
  return records;
}

export function analyzeEdgeDensity(videoPath, workDir, options = {}) {
  const fps = options.fps ?? DEFAULT_FPS;
  const maxSeconds = options.maxSeconds;
  fs.mkdirSync(workDir, { recursive: true });
  const statsPath = path.join(workDir, `edge-density-${process.pid}-${Date.now()}.txt`);
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (maxSeconds) args.push('-t', String(maxSeconds));
  args.push(
    '-i', videoPath,
    '-vf',
    `fps=${fps},crop=iw*0.60:ih*0.60:iw*0.20:ih*0.22,` +
      `edgedetect=low=0.05:high=0.15,format=gray,signalstats,` +
      `metadata=print:file='${filterPath(statsPath)}'`,
    '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
  );
  try {
    execFileSync(ffmpegPath, args, { stdio: 'ignore' });
    return { fps, samples: parseStats(fs.readFileSync(statsPath, 'utf-8')) };
  } finally {
    fs.rmSync(statsPath, { force: true });
  }
}

export function detectLeadingLoadingMs(videoPath, workDir, options = {}) {
  const minEdgeAverage = options.minEdgeAverage ?? DEFAULT_CONTENT_EDGE_AVERAGE;
  const stableContentMs = options.stableContentMs ?? 500;
  const maxSeconds = options.maxSeconds ?? 15;
  const { fps, samples } = analyzeEdgeDensity(videoPath, workDir, { fps: options.fps, maxSeconds });
  if (!samples.length || samples[0].edgeAverage >= minEdgeAverage) return 0;
  const stableSamples = Math.max(1, Math.ceil((stableContentMs / 1000) * fps));
  for (let index = 0; index <= samples.length - stableSamples; index++) {
    const stable = samples.slice(index, index + stableSamples).every((sample) => sample.edgeAverage >= minEdgeAverage);
    if (stable) return Math.round(samples[index].time * 1000);
  }
  return 0;
}

export function findBlankSegments(videoPath, workDir, options = {}) {
  const threshold = options.maxEdgeAverage ?? DEFAULT_BLANK_EDGE_AVERAGE;
  const minimumMs = options.minimumMs ?? 1000;
  const { fps, samples } = analyzeEdgeDensity(videoPath, workDir, { fps: options.fps });
  const frameMs = 1000 / fps;
  const segments = [];
  let current = null;
  for (const sample of samples) {
    if (sample.edgeAverage <= threshold) {
      if (!current || sample.time * 1000 - current.endMs > frameMs * 1.5) {
        if (current) segments.push(current);
        current = { startMs: Math.round(sample.time * 1000), endMs: Math.round(sample.time * 1000 + frameMs) };
      } else {
        current.endMs = Math.round(sample.time * 1000 + frameMs);
      }
    } else if (current) {
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);
  return segments.filter((segment) => segment.endMs - segment.startMs >= minimumMs);
}

export function formatTimestamp(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}
