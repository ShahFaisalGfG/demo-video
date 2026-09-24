import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demoVideoHome } from './npm-env.mjs';

export function ensureOcrPython() {
  const root = path.join(demoVideoHome(), '.demovideo_ocr_venv');
  const python = process.platform === 'win32'
    ? path.join(root, 'Scripts', 'python.exe')
    : path.join(root, 'bin', 'python');
  if (!fs.existsSync(python)) {
    execFileSync('python', ['-m', 'venv', root], { stdio: 'inherit' });
  }
  try {
    execFileSync(python, ['-c', 'import rapidocr_onnxruntime, PIL'], { stdio: 'ignore' });
  } catch {
    execFileSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check',
      'rapidocr-onnxruntime==1.4.4', 'Pillow>=10,<12'], { stdio: 'inherit' });
  }
  return python;
}
