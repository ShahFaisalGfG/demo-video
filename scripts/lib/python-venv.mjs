// Shared lifecycle for the isolated Python environments under ~/.demo_video.
//
// Each feature (Kokoro, Piper, alignment, OCR, desktop input) owns one venv.
// This module finds a system interpreter, creates the venv when it is missing,
// rebuilds it when its interpreter no longer starts (a common result of a
// system Python upgrade), and installs the feature's packages when its import
// check fails. Results are cached per venv for the rest of the process.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ready = new Map();

/** Return the first working system interpreter name, python3 before python. */
export function systemPython(purpose) {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next platform convention.
    }
  }
  throw new Error(`Python 3 is required for ${purpose}. Install it and make "python3" or "python" available on PATH.`);
}

/** Return a console script or interpreter path inside a venv. */
export function venvBin(venvDir, exe) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', `${exe}.exe`)
    : path.join(venvDir, 'bin', exe);
}

/** Return the venv's interpreter path. */
export function venvPython(venvDir) {
  return venvBin(venvDir, 'python');
}

function runs(python, args) {
  try {
    execFileSync(python, args, { stdio: 'ignore', timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

function importCheck(imports) {
  return ['-I', '-c', imports.map((name) => `import ${name}`).join('; ')];
}

/** Report whether a venv exists and imports its modules, without installing anything. */
export function venvReady(venvDir, imports) {
  const python = venvPython(venvDir);
  return fs.existsSync(python) && runs(python, importCheck(imports));
}

/**
 * Create, repair, or complete a venv until its import check passes.
 * `spec` holds `imports` (module names), `packages` (pip requirements), and `purpose` (for messages).
 */
export function ensureVenv(venvDir, spec) {
  const key = `${venvDir}|${spec.imports.join(',')}`;
  if (ready.has(key)) return ready.get(key);
  const python = venvPython(venvDir);
  if (fs.existsSync(venvDir) && !runs(python, ['--version'])) {
    console.warn(`[${spec.purpose}] ${venvDir} has no working interpreter; recreating it.`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(python)) {
    fs.mkdirSync(path.dirname(venvDir), { recursive: true });
    console.log(`[${spec.purpose}] creating isolated environment at ${venvDir} ...`);
    execFileSync(systemPython(spec.purpose), ['-m', 'venv', venvDir], { stdio: 'inherit' });
  }
  if (!runs(python, importCheck(spec.imports))) {
    console.log(`[${spec.purpose}] installing ${spec.packages.join(', ')} ...`);
    execFileSync(python, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...spec.packages],
      { stdio: 'inherit' });
    if (!runs(python, importCheck(spec.imports))) {
      throw new Error(`[${spec.purpose}] ${spec.imports.join(', ')} still fails to import in ${venvDir}.`);
    }
  }
  ready.set(key, python);
  return python;
}
