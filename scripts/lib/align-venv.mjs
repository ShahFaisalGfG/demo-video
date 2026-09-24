import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demoVideoHome } from './npm-env.mjs';

const VENV_DIR = path.join(demoVideoHome(), '.demovideo_align_venv');

function pythonPath() {
  return process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python');
}

function systemPython() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next interpreter name.
    }
  }
  throw new Error('Python 3 is required for word-level subtitle alignment.');
}

function healthy() {
  if (!fs.existsSync(pythonPath())) return false;
  try {
    execFileSync(pythonPath(), ['-c', 'import faster_whisper'], { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export function ensureAlignEnv() {
  if (!fs.existsSync(VENV_DIR)) {
    execFileSync(systemPython(), ['-m', 'venv', VENV_DIR], { stdio: 'inherit' });
  }
  if (!healthy()) {
    console.log('[subtitle-align] installing faster-whisper in the isolated alignment environment...');
    execFileSync(pythonPath(), ['-m', 'pip', 'install', '--quiet', 'faster-whisper>=1.1.0,<2'], {
      stdio: 'inherit',
    });
  }
  return { pythonBin: pythonPath(), venvDir: VENV_DIR };
}

export function alignEnvReady() {
  return healthy();
}

export function alignPython() {
  return pythonPath();
}
