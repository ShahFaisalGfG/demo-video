// Bootstraps the fully isolated ~/.demo_video environment this skill uses
// for ALL of its tooling - npm packages, the Chromium browser binary, and
// (lazily, via piper-venv.mjs on first synthesis) the Python venv and voice
// models. Nothing this skill needs is ever installed into the project
// you're generating a demo for.
//
// Always run this first, every time a demo video is generated - it's a fast
// no-op if everything's already in place (a handful of existence checks),
// and self-heals anything that's missing without needing to be told what.
//
// IMPORTANT: run this via its original bundled location, e.g.
//   node "${CLAUDE_SKILL_DIR}/scripts/bootstrap.mjs"
// not via the copy it creates at ~/.demo_video/scripts/bootstrap.mjs - this
// file locates its sibling scripts relative to its own path specifically so
// it can sync them forward; running the copy would just sync it to itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoVideoHome, ensureIsolatedDeps } from './lib/npm-env.mjs';

const home = demoVideoHome();
const scriptsDir = path.join(home, 'scripts');
const sourceScriptsDir = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(home, { recursive: true });

if (path.resolve(sourceScriptsDir) === path.resolve(scriptsDir)) {
  console.log('[bootstrap] already running from the isolated location; skipping script sync. ' +
    'Run this from its original skill location instead to pick up updates.');
} else {
  fs.rmSync(scriptsDir, { recursive: true, force: true });
  fs.cpSync(sourceScriptsDir, scriptsDir, { recursive: true });
  console.log(`[bootstrap] pipeline scripts synced to ${scriptsDir}`);
}

ensureIsolatedDeps();

console.log(`[bootstrap] ready: ${home}`);
