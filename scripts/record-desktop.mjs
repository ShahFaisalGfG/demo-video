import path from 'node:path';
import { recordDesktop } from './lib/desktop-recorder.mjs';

const [definitionPath, outputPath] = process.argv.slice(2);
if (!definitionPath || !outputPath) {
  console.error('Usage: node record-desktop.mjs <resolved-desktop-recording.json> <output.mp4>');
  process.exit(1);
}
const result = await recordDesktop(path.resolve(definitionPath), path.resolve(outputPath));
console.log(`[record-desktop] ${result.video}`);
