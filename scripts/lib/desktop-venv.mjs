import path from 'node:path';
import { demoVideoHome } from './npm-env.mjs';
import { ensureVenv } from './python-venv.mjs';

const VENV_DIR = path.join(demoVideoHome(), '.demovideo_desktop_venv');
const PACKAGES = ['PyAutoGUI>=0.9.54,<1', 'Pillow>=10,<12', 'opencv-python-headless>=4.9,<5'];

/** Interpreter for native desktop input; importing PyAutoGUI needs a display on Linux. */
export function ensureDesktopEnv() {
  return ensureVenv(VENV_DIR, { imports: ['pyautogui', 'PIL', 'cv2', 'numpy'], packages: PACKAGES,
    purpose: 'native desktop automation' });
}

/** Interpreter for the deglitch filter, which needs only NumPy and so also runs on hosts without a display. */
export function ensureDeglitchEnv() {
  return ensureVenv(VENV_DIR, { imports: ['numpy'], packages: PACKAGES, purpose: 'capture deglitching' });
}
