import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_PREFIX, backupFolder, listBackups, skillHostRoots } from './lib/skill-hosts.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostIndex = process.argv.indexOf('--host');
const destinationIndex = process.argv.indexOf('--destination');
const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : 'all';
const explicitDestination = destinationIndex >= 0 ? process.argv[destinationIndex + 1] : null;
const force = process.argv.includes('--force');
const roots = skillHostRoots();
const hosts = host === 'all' ? Object.keys(roots) : [host];
if (hosts.some((name) => !(name in roots))) throw new Error(`Unknown host ${host}. Use codex, claude, cursor, agents, or all.`);

/** Move a folder to a new path, copying it when the new path is on another drive. */
function moveFolder(source, destination) {
  if (fs.existsSync(destination)) throw new Error(`${destination} already exists`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.renameSync(source, destination);
    return;
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
  }
  try {
    fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(source, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Move backups that earlier versions kept beside the installed copy, where hosts load them as skills. */
function moveLeftoverBackups(skillsFolder, backups) {
  for (const name of listBackups(skillsFolder)) {
    const source = path.join(skillsFolder, name);
    if (source === skillRoot) continue; // This install runs from that backup; the next install moves it.
    try {
      moveFolder(source, path.join(backups, name));
      console.log(`[install] moved earlier backup ${source} to ${backups}`);
    } catch (error) {
      console.warn(`[install] left earlier backup ${source} in place: ${error.message}`);
    }
  }
}

/** Install into skillsFolder/demo-video; with --force, the replaced copy moves to the backup folder. */
function copySkill(skillsFolder) {
  const folder = path.resolve(skillsFolder);
  const target = path.join(folder, 'demo-video');
  const backups = backupFolder(folder);
  moveLeftoverBackups(folder, backups);
  if (target === skillRoot) {
    console.log(`[install] already installed at ${target}`);
    return;
  }
  if (fs.existsSync(target)) {
    if (!force) throw new Error(`${target} exists. Re-run with --force to replace it.`);
    const backup = path.join(backups, `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}`);
    moveFolder(target, backup);
    console.log(`[install] preserved previous copy at ${backup}`);
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter: (source) => !['.git', 'dist', '__pycache__'].includes(path.basename(source)) && !source.endsWith('.partial'),
  });
  console.log(`[install] installed ${target}`);
}

if (explicitDestination) {
  copySkill(explicitDestination);
} else {
  for (const name of hosts) copySkill(roots[name]);
}
