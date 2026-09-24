import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demoVideoHome } from './npm-env.mjs';

function systemPython() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next platform convention.
    }
  }
  throw new Error('Python 3 is required for native desktop automation.');
}

export function ensureDesktopEnv() {
  const root = path.join(demoVideoHome(), '.demovideo_desktop_venv');
  const python = process.platform === 'win32'
    ? path.join(root, 'Scripts', 'python.exe')
    : path.join(root, 'bin', 'python');
  if (!fs.existsSync(python)) execFileSync(systemPython(), ['-m', 'venv', root], { stdio: 'inherit' });
  try {
    execFileSync(python, ['-c', 'import pyautogui, PIL'], { stdio: 'ignore', timeout: 15_000 });
  } catch {
    execFileSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check',
      'PyAutoGUI>=0.9.54,<1', 'Pillow>=10,<12', 'opencv-python-headless>=4.9,<5'], { stdio: 'inherit' });
  }
  return python;
}
