import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureAlignEnv } from './lib/align-venv.mjs';
import { demoVideoHome } from './lib/npm-env.mjs';

const [inputPath, outputPath, ...options] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error(
    'Usage: node align-subtitles.mjs <input.mp4> <output.srt> ' +
    '[--source-srt approved.srt] [--model tiny.en] [--language en] [--max-words 8] [--max-line-chars 39]',
  );
  process.exit(1);
}
const { pythonBin } = ensureAlignEnv();
const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'align-subtitles.py');
execFileSync(pythonBin, [scriptPath, inputPath, outputPath, ...options], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HF_HOME: path.join(demoVideoHome(), '.demovideo_align_models'),
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
  },
});
