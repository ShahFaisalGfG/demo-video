import path from 'node:path';
import { browsersDir, demoVideoHome } from './lib/npm-env.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? browsersDir(demoVideoHome());
const { recordDefinition } = await import('./lib/recorder-adapter.mjs');

const [definitionPath, outputDir = './demo/output'] = process.argv.slice(2);
if (!definitionPath) {
  console.error('Usage: node record-video.mjs <recording.json> [output-directory]');
  process.exit(1);
}

const result = await recordDefinition(path.resolve(definitionPath), { outputDir: path.resolve(outputDir) });
console.log(`[record-video] ${result.video}`);
