// Signed update checks for the installed skill.
//
// Every release publishes release-manifest.json with a detached signature, release-manifest.json.sig:
// ECDSA P-256 over SHA-256 of the manifest's exact bytes, saved as base64 raw r||s by
// scripts/sign_update.py. A manifest counts only when a key in UPDATE_PUBLIC_KEYS verifies it.
//
// bootstrap.mjs checks at most once a day and keeps the result in ~/.demo_video/update-check.json,
// outside ~/.demo_video/scripts because bootstrap replaces that folder; doctor.mjs reports the saved
// result. Nothing here installs anything: scripts/update-skill.mjs does that once the user agrees.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demoVideoHome } from './npm-env.mjs';

export const RELEASES_URL = 'https://github.com/ShahFaisalGfG/demo-video/releases';
const MANIFEST_NAME = 'release-manifest.json';

// The public half of each release signing key, exactly as `openssl ec -in key.pem -pubout` prints it.
// The release workflow refuses to publish a manifest that none of these keys verifies. To replace a
// key, publish a release signed with the current key that lists both, then sign with the new one.
// While the list is empty, the check reports "update check not configured" and offers nothing.
// The private half is kept in Doppler (project demo-video, config prd) and copied to the
// UPDATE_SIGNING_KEY Actions secret.
export const UPDATE_PUBLIC_KEYS = [
  `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEEEtFwiiHLkJjq+UhvElR2Mxt0UUQ
PgImf19eYojfasaE5I9nI0zo5titw/37DaJfGAFZ05+pXwRuV0onw6WfcA==
-----END PUBLIC KEY-----
`,
];

const FETCH_TIMEOUT_MS = 5_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const SIGNATURE_BYTES = 64;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const DISABLE_VARIABLE = 'DEMO_VIDEO_NO_UPDATE_CHECK';

/** A manifest that no trusted key verifies. */
export class UpdateSignatureError extends Error {}

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(String(version));
  if (!match) throw new Error(`"${version}" is not an X.Y.Z version.`);
  return match.slice(1).map(Number);
}

/** Compare two X.Y.Z versions part by part: negative, zero, or positive, like a sort comparator. */
export function compareVersions(left, right) {
  const [a, b] = [parseVersion(left), parseVersion(right)];
  return a.map((part, index) => part - b[index]).find((difference) => difference !== 0) ?? 0;
}

/** The X.Y.Z version in a skill folder's VERSION file. */
export function readSkillVersion(skillRoot) {
  const file = path.join(skillRoot, 'VERSION');
  const version = fs.readFileSync(file, 'utf8').trim();
  if (!VERSION_PATTERN.test(version)) throw new Error(`${file} does not hold an X.Y.Z version.`);
  return version;
}

function p256Key(pem) {
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Update signing keys must be ECDSA P-256 public keys.');
  }
  return key;
}

/** True when `signature` (the .sig file's base64 text) signs `data` under one of `publicKeys` (PEM). */
export function verifySignature(data, signature, publicKeys) {
  const text = String(signature).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  const raw = Buffer.from(text, 'base64');
  if (raw.length !== SIGNATURE_BYTES) return false;
  return publicKeys.some((pem) => crypto.verify('sha256', data, { key: p256Key(pem), dsaEncoding: 'ieee-p1363' }, raw));
}

/**
 * Verify a release manifest's signature, then its fields; returns the parsed manifest.
 * `files` (the archive's file count) is informational: the SHA-256 already pins the archive.
 */
export function verifiedManifest(data, signature, publicKeys) {
  if (!verifySignature(data, signature, publicKeys)) {
    throw new UpdateSignatureError('the release manifest does not carry a valid signature');
  }
  const manifest = JSON.parse(data.toString('utf8'));
  parseVersion(manifest.version);
  if (manifest.name !== 'demo-video' || manifest.archive !== `demo-video_${manifest.version}_skill.zip`
    || !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    throw new Error('the release manifest does not describe a demo-video skill archive');
  }
  return manifest;
}

async function fetchSmall(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_MANIFEST_BYTES) throw new Error(`${url} is larger than ${MAX_MANIFEST_BYTES} bytes`);
  return body;
}

/**
 * Download the latest release manifest and its signature, and return the verified manifest.
 * Both requests share one timeout, and whichever is still running stops when the other fails.
 */
export async function fetchRelease({ releasesUrl = RELEASES_URL, publicKeys = UPDATE_PUBLIC_KEYS } = {}) {
  const url = `${releasesUrl}/latest/download/${MANIFEST_NAME}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const [data, signature] = await Promise.all([url, `${url}.sig`].map((target) => fetchSmall(target, controller.signal)));
    return verifiedManifest(data, signature, publicKeys);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`no answer from ${releasesUrl} within ${FETCH_TIMEOUT_MS / 1000} seconds`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** File that holds the last check's result; its age decides when the next check runs. */
export function updateCheckFile() {
  return path.join(demoVideoHome(), 'update-check.json');
}

/** Save a check result, replacing the previous one in a single rename. */
export function saveUpdateCheck(result, cacheFile = updateCheckFile()) {
  const partial = `${cacheFile}.${process.pid}.partial`;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(partial, `${JSON.stringify(result, null, 2)}\n`);
    fs.renameSync(partial, cacheFile);
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

function freshCheck(cacheFile, currentVersion) {
  try {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    // A new file's time can run a fraction of a millisecond ahead of Date.now(); a time far
    // ahead means the clock was turned back, so that saved check no longer counts.
    if (age > CHECK_INTERVAL_MS || age < -CLOCK_SKEW_MS) return null;
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return cached.current === currentVersion ? cached : null;
  } catch {
    return null; // No saved result, or an unreadable one: check again.
  }
}

/**
 * Compare `currentVersion` with the latest signed release, at most once a day. Never throws: a
 * network failure, a bad signature, or a malformed manifest becomes the result's status.
 * Statuses: update-available, up-to-date, unverified, failed, disabled, not-configured.
 */
export async function checkForUpdate(currentVersion, options = {}) {
  const { releasesUrl, publicKeys = UPDATE_PUBLIC_KEYS, cacheFile = updateCheckFile() } = options;
  if (process.env[DISABLE_VARIABLE] === '1') return { status: 'disabled', current: currentVersion };
  if (!publicKeys.length) return { status: 'not-configured', current: currentVersion };
  const cached = freshCheck(cacheFile, currentVersion);
  if (cached) return cached;
  let result;
  try {
    const manifest = await fetchRelease({ releasesUrl, publicKeys });
    const newer = compareVersions(manifest.version, currentVersion) > 0;
    result = { status: newer ? 'update-available' : 'up-to-date', current: currentVersion, latest: manifest.version };
  } catch (error) {
    const status = error instanceof UpdateSignatureError ? 'unverified' : 'failed';
    result = { status, current: currentVersion, detail: error.message };
  }
  try {
    saveUpdateCheck(result, cacheFile);
  } catch {
    // Without a saved result the next bootstrap checks again; the check must never fail bootstrap.
  }
  return result;
}

/** Doctor's view of the last saved check: `passed` is false only when something needs attention. */
export function updateCheckSummary(cacheFile = updateCheckFile()) {
  if (process.env[DISABLE_VARIABLE] === '1') return { passed: true, detail: `update check off (${DISABLE_VARIABLE}=1)` };
  if (!UPDATE_PUBLIC_KEYS.length) return { passed: true, detail: 'update check not configured' };
  let cached;
  let checked;
  try {
    checked = fs.statSync(cacheFile).mtime;
    cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    return { passed: true, detail: 'not checked yet; bootstrap checks once a day' };
  }
  const when = `checked ${checked.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  switch (cached.status) {
    case 'up-to-date':
      return { passed: true, detail: `${cached.current} is the latest release (${when})` };
    case 'update-available':
      return { passed: false, detail: `${cached.latest} is available, ${cached.current} is installed; `
        + `update with scripts/update-skill.mjs once the user agrees (${when})` };
    case 'unverified':
      return { passed: false, detail: `the latest release manifest failed its signature check, so no update is offered (${when})` };
    default:
      return { passed: false, detail: `the last check failed: ${cached.detail} (${when})` };
  }
}
