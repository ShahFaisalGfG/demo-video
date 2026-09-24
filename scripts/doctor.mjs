import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { browsersDir, demoVideoHome } from './lib/npm-env.mjs';

function command(name, args = ['--version']) {
  try {
    return execFileSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim();
  } catch {
    return null;
  }
}

const checks = [];
function add(name, passed, level, detail) {
  checks.push({ name, passed, level, detail });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
add('Node.js', nodeMajor >= 20, 'required', `v${process.versions.node}; requires 20 or newer`);
add('Operating system', ['win32', 'linux', 'darwin'].includes(process.platform), 'required', `${process.platform}/${process.arch}`);
add('Bundled FFmpeg', Boolean(ffmpegPath && fs.existsSync(ffmpegPath)), 'required', ffmpegPath ?? 'missing');
const browserRoot = browsersDir(demoVideoHome());
const browserReady = fs.existsSync(browserRoot) && fs.readdirSync(browserRoot).some((entry) => entry.startsWith('chromium'));
add('Chromium', browserReady, 'web', browserReady ? browserRoot : 'run scripts/bootstrap.mjs');
const python = command('python3') ?? command('python');
add('Python', Boolean(python), 'narration-desktop', python ?? 'Python 3 is unavailable');

let devices = '';
if (ffmpegPath && fs.existsSync(ffmpegPath)) {
  try {
    devices = execFileSync(ffmpegPath, ['-hide_banner', '-devices'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    devices = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
}
if (process.platform === 'win32') add('Desktop capture', devices.includes('gdigrab'), 'desktop', 'Windows gdigrab');
if (process.platform === 'darwin') add('Desktop capture', devices.includes('avfoundation'), 'desktop', 'macOS avfoundation; Screen Recording and Accessibility permissions required');
if (process.platform === 'linux') {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  add('Desktop capture', devices.includes('x11grab') && Boolean(process.env.DISPLAY), 'desktop',
    wayland ? 'Wayland detected; use an X11 session, OBS/portal capture, or --reuse-video' : `X11 display ${process.env.DISPLAY ?? 'missing'}`);
}
try {
  const disk = fs.statfsSync(demoVideoHome());
  const availableGb = disk.bavail * disk.bsize / 1024 ** 3;
  add('Free cache space', availableGb >= 2, 'recommended', `${availableGb.toFixed(1)} GB available`);
} catch {
  add('Free cache space', true, 'recommended', 'not measured');
}

const failedRequired = checks.filter((check) => check.level === 'required' && !check.passed);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ platform: process.platform, passed: failedRequired.length === 0, checks }, null, 2));
} else {
  for (const check of checks) console.log(`${check.passed ? 'PASS' : 'WARN'} ${check.name}: ${check.detail}`);
}
if (failedRequired.length) process.exit(1);
