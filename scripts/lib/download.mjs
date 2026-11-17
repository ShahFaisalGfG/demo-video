// Verified file downloads, shared by the Kokoro model download and the skill updater. A download
// streams through a uniquely named partial file and takes its final name only after its SHA-256
// digest matches the expected one.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Stream `url` into `target`, checking its SHA-256 before the file takes its final name.
 * The download stops when no data arrives for `idleMs`; `label` names the download in errors.
 */
export async function downloadVerified(url, target, { sha256, idleMs, label }) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.partial`;
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), idleMs);
  const hash = crypto.createHash('sha256');
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`${label} failed: HTTP ${response.status}.`);
    await pipeline(Readable.fromWeb(response.body), async function* digest(chunks) {
      for await (const chunk of chunks) {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), idleMs);
        hash.update(chunk);
        yield chunk;
      }
    }, fs.createWriteStream(partial));
    const digest = hash.digest('hex');
    if (digest !== sha256) throw new Error(`${path.basename(target)} failed its checksum (${digest}).`);
    fs.renameSync(partial, target);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${label} stalled for ${idleMs / 1000} seconds.`, { cause: error });
    throw error;
  } finally {
    clearTimeout(idle);
    fs.rmSync(partial, { force: true });
  }
  return target;
}
