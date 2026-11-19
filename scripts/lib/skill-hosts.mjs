// User skill folders of the supported agent hosts, and the folders that keep replaced copies.
// install-skill.mjs installs into the skill folders and keeps each replaced copy as a backup;
// update-skill.mjs updates the copies it finds there and prunes their older backups.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoVideoHome } from './npm-env.mjs';

/** Name prefix of a backup; the rest of the name is an ISO timestamp, so names sort oldest first. */
export const BACKUP_PREFIX = 'demo-video.backup-';

/** Skill folder of each supported host, resolved from the current environment. */
export function skillHostRoots() {
  return {
    codex: path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills'),
    claude: path.join(os.homedir(), '.claude', 'skills'),
    cursor: path.join(os.homedir(), '.cursor', 'skills'),
    agents: path.join(os.homedir(), '.agents', 'skills'),
  };
}

/**
 * Folder that keeps the copies replaced in a skill folder: ~/.demo_video/backups/<host> for a host
 * skill folder, or backups/destination-<hash of the path> for any other. Hosts load every entry of
 * a skill folder that holds a SKILL.md, so a backup kept beside the installed copy would load as a
 * second demo-video skill.
 */
export function backupFolder(skillsFolder) {
  const folder = path.resolve(skillsFolder);
  const host = Object.entries(skillHostRoots()).find(([, root]) => path.resolve(root) === folder)?.[0];
  const name = host ?? `destination-${crypto.createHash('sha1').update(folder).digest('hex').slice(0, 10)}`;
  return path.join(demoVideoHome(), 'backups', name);
}

/** Backup names in `folder`, oldest first; a missing folder holds none. */
export function listBackups(folder) {
  try {
    return fs.readdirSync(folder).filter((name) => name.startsWith(BACKUP_PREFIX)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
