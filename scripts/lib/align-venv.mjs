import path from 'node:path';
import { demoVideoHome } from './npm-env.mjs';
import { ensureVenv, venvPython, venvReady } from './python-venv.mjs';

const VENV_DIR = path.join(demoVideoHome(), '.demovideo_align_venv');
const SPEC = {
  imports: ['faster_whisper'],
  packages: ['faster-whisper>=1.1.0,<2'],
  purpose: 'speech alignment',
};

/** Hugging Face cache shared by alignment, voice scoring, and narration verification. */
export const ALIGN_MODEL_DIR = path.join(demoVideoHome(), '.demovideo_align_models');

export function ensureAlignEnv() {
  return { pythonBin: ensureVenv(VENV_DIR, SPEC), venvDir: VENV_DIR };
}

export function alignEnvReady() {
  return venvReady(VENV_DIR, SPEC.imports);
}

export function alignPython() {
  return venvPython(VENV_DIR);
}

/** Environment for faster-whisper children: the shared model cache, with downloads blocked unless allowed. */
export function alignEnvironment(allowDownload = true) {
  return {
    ...process.env,
    HF_HOME: ALIGN_MODEL_DIR,
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    ...(allowDownload ? {} : { HF_HUB_OFFLINE: '1' }),
  };
}
