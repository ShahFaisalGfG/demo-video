import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostIndex = process.argv.indexOf('--host');
const destinationIndex = process.argv.indexOf('--destination');
const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : 'all';
const explicitDestination = destinationIndex >= 0 ? process.argv[destinationIndex + 1] : null;
const force = process.argv.includes('--force');
const roots = {
  codex: path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills'),
  claude: path.join(os.homedir(), '.claude', 'skills'),
  cursor: path.join(os.homedir(), '.cursor', 'skills'),
  agents: path.join(os.homedir(), '.agents', 'skills'),
};
const hosts = host === 'all' ? Object.keys(roots) : [host];
if (hosts.some((name) => !(name in roots))) throw new Error(`Unknown host ${host}. Use codex, claude, cursor, agents, or all.`);

function copySkill(target) {
  if (path.resolve(target) === skillRoot) {
    console.log(`[install] already installed at ${target}`);
    return;
  }
  if (fs.existsSync(target)) {
    if (!force) throw new Error(`${target} exists. Re-run with --force to replace it.`);
    const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(target, backup);
    console.log(`[install] preserved previous copy at ${backup}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter: (source) => !['.git', 'dist', '__pycache__'].includes(path.basename(source)) && !source.endsWith('.partial'),
  });
  console.log(`[install] installed ${target}`);
}

if (explicitDestination) {
  copySkill(path.join(path.resolve(explicitDestination), 'demo-video'));
} else {
  for (const name of hosts) copySkill(path.join(roots[name], 'demo-video'));
}
