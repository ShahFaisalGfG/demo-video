import path from 'node:path';
import { demoVideoHome } from './npm-env.mjs';
import { ensureVenv } from './python-venv.mjs';

export function ensureOcrPython() {
  return ensureVenv(path.join(demoVideoHome(), '.demovideo_ocr_venv'), {
    imports: ['rapidocr_onnxruntime', 'PIL'],
    packages: ['rapidocr-onnxruntime==1.4.4', 'Pillow>=10,<12'],
    purpose: 'OCR evidence',
  });
}
