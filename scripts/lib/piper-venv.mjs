// Manages a dedicated, isolated Python virtual environment for Piper, so
// this skill never installs anything into the target project's own venv.
//
// Location: `~/.demo_video/.demovideo_venv` - see npm-env.mjs for why this
// skill anchors everything to the user's home directory rather than the
// project or wherever the skill itself happens to be installed.
//
// Lifecycle, checked once per process (cached after the first call):
//   - missing entirely      -> create it and install piper-tts
//   - present but corrupted -> wipe and recreate it
//   - present but outdated  -> upgrade piper-tts in place
//   - present and healthy   -> use as-is
//
// "Corrupted" here means the `piper` console script is missing or fails to
// even print its own help text - the most common cause is a venv
// whose Python interpreter symlink went stale after a system Python
// upgrade/uninstall, which no amount of `pip install` can fix, so a full
// recreate is the only reliable repair.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demoVideoHome } from './npm-env.mjs';

const VENV_DIRNAME = '.demovideo_venv';
const MIN_PIPER_VERSION = '1.6.0';

let cached;

function isWindows() {
  return process.platform === 'win32';
}

function venvBin(venvDir, exe) {
  return isWindows()
    ? path.join(venvDir, 'Scripts', `${exe}.exe`)
    : path.join(venvDir, 'bin', exe);
}

function findSystemPython() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('No "python3" or "python" found on PATH. Install Python 3 to use the piper voice engine.');
}

function resolveVenvDir(cfg = {}) {
  if (cfg.venvDir) return cfg.venvDir;
  return path.join(demoVideoHome(), VENV_DIRNAME);
}

function isHealthy(venvDir) {
  const piperBin = venvBin(venvDir, 'piper');
  if (!fs.existsSync(piperBin)) return false;
  try {
    execFileSync(piperBin, ['--help'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function installedVersion(venvDir) {
  try {
    const out = execFileSync(venvBin(venvDir, 'pip'), ['show', 'piper-tts'], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    return out.match(/^Version:\s*(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function isAtLeast(version, min) {
  const parts = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function createVenv(venvDir) {
  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  console.log(`[piper-venv] creating isolated venv at ${venvDir} ...`);
  execFileSync(findSystemPython(), ['-m', 'venv', venvDir], { stdio: 'inherit' });
  console.log('[piper-venv] installing piper-tts ...');
  execFileSync(venvBin(venvDir, 'pip'), ['install', '--quiet', `piper-tts>=${MIN_PIPER_VERSION}`], {
    stdio: 'inherit',
  });
}

function repairVenv(venvDir) {
  console.warn(`[piper-venv] ${venvDir} looks corrupted (piper binary missing or non-functional); recreating it.`);
  fs.rmSync(venvDir, { recursive: true, force: true });
  createVenv(venvDir);
}

function updateVenv(venvDir) {
  console.log(`[piper-venv] upgrading piper-tts in ${venvDir} ...`);
  execFileSync(venvBin(venvDir, 'pip'), ['install', '--quiet', '--upgrade', `piper-tts>=${MIN_PIPER_VERSION}`], {
    stdio: 'inherit',
  });
}

/**
 * Ensures the dedicated venv exists, isn't corrupted, and meets the minimum
 * piper-tts version, self-healing whichever of those isn't true. Returns the
 * venv's `piper` and `python` binary paths, plus the venv directory itself
 * (so callers can nest other venv-local caches, e.g. voice models,
 * consistently alongside it rather than in the project).
 */
export function ensurePiperEnv(cfg = {}) {
  if (cached) return cached;

  const venvDir = resolveVenvDir(cfg);

  if (!fs.existsSync(venvDir)) {
    createVenv(venvDir);
  } else if (!isHealthy(venvDir)) {
    repairVenv(venvDir);
  } else {
    const version = installedVersion(venvDir);
    if (!version || !isAtLeast(version, MIN_PIPER_VERSION)) {
      updateVenv(venvDir);
    }
  }

  cached = {
    venvDir,
    piperBin: venvBin(venvDir, 'piper'),
    pythonBin: venvBin(venvDir, 'python'),
  };
  return cached;
}
