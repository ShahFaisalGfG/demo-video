// Updates every installed copy of this skill to the latest signed release:
//
//   node <skill-dir>/scripts/update-skill.mjs
//
// Run it only when the user agrees, and never while a render is running: it replaces the skill
// folders that agents read from. The manifest counts only when a key in scripts/lib/update-check.mjs
// verifies its signature, and the archive it names must match the manifest's SHA-256. The archive is
// unpacked into a new empty folder, and the new copy's install-skill.mjs replaces each host's older
// copy. install-skill.mjs keeps the replaced copy in ~/.demo_video/backups/<host>, outside the skill
// folders that hosts load skills from; each host keeps only its newest backup.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { downloadVerified } from './lib/download.mjs';
import { systemPython } from './lib/python-venv.mjs';
import { backupFolder, listBackups, skillHostRoots } from './lib/skill-hosts.mjs';
import {
  RELEASES_URL, UPDATE_PUBLIC_KEYS, compareVersions, fetchRelease, readSkillVersion, saveUpdateCheck,
} from './lib/update-check.mjs';

const DOWNLOAD_IDLE_MS = 60_000;

/** Each host folder holding demo-video/VERSION, once per real folder. */
function installedCopies() {
  const seen = new Set();
  return Object.entries(skillHostRoots()).flatMap(([host, root]) => {
    const folder = path.join(root, 'demo-video');
    if (!fs.existsSync(path.join(folder, 'VERSION'))) return [];
    const real = fs.realpathSync(folder);
    if (seen.has(real)) return [];
    seen.add(real);
    return [{ host, root, folder, version: readSkillVersion(folder) }];
  });
}

/** Remove all but the newest backup in a backup folder. */
function pruneBackups(folder) {
  for (const name of listBackups(folder).slice(0, -1)) {
    try {
      fs.rmSync(path.join(folder, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      // A backup still in use is removed by a later update; the new copy is already in place.
      console.warn(`[update] kept ${path.join(folder, name)}: ${error.message}`);
    }
  }
}

/** Download and check the release archive, then unpack it; returns the unpacked skill folder. */
async function unpackRelease(manifest, releasesUrl, workDir) {
  const archive = path.join(workDir, manifest.archive);
  await downloadVerified(`${releasesUrl}/download/v${manifest.version}/${manifest.archive}`, archive,
    { sha256: manifest.sha256, idleMs: DOWNLOAD_IDLE_MS, label: `Download of ${manifest.archive}` });
  const unpacked = path.join(workDir, 'unpacked');
  fs.mkdirSync(unpacked);
  execFileSync(systemPython('unpacking the update'), ['-I', '-m', 'zipfile', '-e', archive, unpacked],
    { cwd: workDir, stdio: 'inherit' });
  const skill = path.join(unpacked, 'demo-video');
  if (!fs.existsSync(path.join(skill, 'scripts', 'install-skill.mjs')) || readSkillVersion(skill) !== manifest.version) {
    throw new Error(`${manifest.archive} does not hold demo-video ${manifest.version}.`);
  }
  return skill;
}

/**
 * Replace every installed copy older than the latest signed release, and return the release
 * version with the copies it replaced. The options default to the published releases and keys.
 */
export async function updateSkill({ releasesUrl = RELEASES_URL, publicKeys = UPDATE_PUBLIC_KEYS } = {}) {
  if (!publicKeys.length) {
    throw new Error(`update check not configured in this copy; install the latest release from ${RELEASES_URL}/latest`);
  }
  const copies = installedCopies();
  if (!copies.length) {
    throw new Error(`no installed copy found in ${Object.values(skillHostRoots()).join(', ')}`);
  }
  const manifest = await fetchRelease({ releasesUrl, publicKeys });
  const outdated = copies.filter((copy) => compareVersions(copy.version, manifest.version) < 0);
  if (outdated.length) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-video-update-'));
    try {
      const install = path.join(await unpackRelease(manifest, releasesUrl, workDir), 'scripts', 'install-skill.mjs');
      for (const copy of outdated) {
        execFileSync(process.execPath, [install, '--force', '--host', copy.host], { stdio: 'inherit' });
        pruneBackups(backupFolder(copy.root));
        console.log(`[update] ${copy.host}: demo-video ${copy.version} replaced by ${manifest.version}`);
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  try {
    saveUpdateCheck({ status: 'up-to-date', current: manifest.version, latest: manifest.version });
  } catch (error) {
    console.warn(`[update] the result was not saved, so the next bootstrap checks again: ${error.message}`);
  }
  return { version: manifest.version, updated: outdated };
}

function invokedDirectly() {
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false; // No script path, as under `node -e`; the release test imports updateSkill instead.
  }
}

if (invokedDirectly()) {
  try {
    const { version, updated } = await updateSkill();
    if (!updated.length) {
      console.log(`[update] every installed copy is up to date with demo-video ${version}.`);
    } else {
      console.log(`[update] done. Run bootstrap from the updated skill before the next video:\n`
        + `  node "${path.join(updated[0].folder, 'scripts', 'bootstrap.mjs')}"`);
    }
  } catch (error) {
    console.error(`[update] ${error.message}`);
    process.exitCode = 1;
  }
}
