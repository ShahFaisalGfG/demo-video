// Kokoro v1.0 runtime: an isolated venv with kokoro-onnx, plus model files
// downloaded once from the kokoro-onnx model release. Each download is checked
// against a pinned SHA-256 digest before it takes its final name; a file
// already in place with the expected size is used as is (placed by an earlier
// verified download, or by hand on an offline host).
//
// Files live in ~/.demo_video/.demovideo_voices/kokoro, shared by every
// project. The full-precision model is the default because it gives the
// cleanest voice; fp16 and int8 trade a little quality for size and speed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { demoVideoHome } from './npm-env.mjs';
import { ensureVenv } from './python-venv.mjs';

const RELEASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
export const KOKORO_MODELS = {
  fp32: { file: 'kokoro-v1.0.onnx', bytes: 325532387,
    sha256: '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5' },
  fp16: { file: 'kokoro-v1.0.fp16.onnx', bytes: 177464787,
    sha256: 'c1610a859f3bdea01107e73e50100685af38fff88f5cd8e5c56df109ec880204' },
  int8: { file: 'kokoro-v1.0.int8.onnx', bytes: 92361271,
    sha256: '6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb' },
};
const VOICES = { file: 'voices-v1.0.bin', bytes: 28214398,
  sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' };
const LANGUAGES = { a: 'en-us', b: 'en-gb', e: 'es', f: 'fr-fr', h: 'hi', i: 'it', p: 'pt-br', j: 'ja', z: 'cmn' };
const SPEC = {
  imports: ['kokoro_onnx', 'soundfile'],
  packages: ['kokoro-onnx>=0.4,<1', 'soundfile>=0.12,<1'],
  purpose: 'Kokoro narration',
};

const DOWNLOAD_IDLE_MS = 60_000;

export const DEFAULT_KOKORO_VOICE = 'am_michael';
export const DEFAULT_KOKORO_PRECISION = 'fp32';
const prepared = new Map();

/** Folder holding the Kokoro model and voice files. */
export function kokoroModelDir() {
  return path.join(demoVideoHome(), '.demovideo_voices', 'kokoro');
}

/** Folder of the isolated Kokoro Python environment. */
export function kokoroVenvDir() {
  return path.join(demoVideoHome(), '.demovideo_kokoro_venv');
}

/** Language for a voice: an explicit setting, else the voice's prefix (am_ is US English, bm_ British English). */
export function kokoroLanguage(cfg = {}) {
  return cfg.kokoroLang ?? LANGUAGES[(cfg.kokoroVoice ?? DEFAULT_KOKORO_VOICE)[0]] ?? 'en-us';
}

/** The pinned model release entry for the configured precision. */
export function kokoroModelAsset(cfg = {}) {
  const precision = cfg.kokoroPrecision ?? DEFAULT_KOKORO_PRECISION;
  const asset = KOKORO_MODELS[precision];
  if (!asset) throw new Error(`kokoroPrecision must be one of ${Object.keys(KOKORO_MODELS).join(', ')}.`);
  return asset;
}

/** Report whether the pinned model and voice files are present, without downloading them. */
export function kokoroModelsPresent(cfg = {}) {
  return [kokoroModelAsset(cfg), VOICES].every((asset) => {
    const file = path.join(kokoroModelDir(), asset.file);
    return fs.existsSync(file) && fs.statSync(file).size === asset.bytes;
  });
}

async function download(asset, directory) {
  const target = path.join(directory, asset.file);
  if (fs.existsSync(target) && fs.statSync(target).size === asset.bytes) return target;
  fs.mkdirSync(directory, { recursive: true });
  const partial = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.partial`;
  console.log(`[kokoro] downloading ${asset.file} (${Math.round(asset.bytes / 1e6)} MB, one time) ...`);
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_MS);
  const hash = crypto.createHash('sha256');
  try {
    const response = await fetch(`${RELEASE}/${asset.file}`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Kokoro download failed: HTTP ${response.status} for ${asset.file}.`);
    await pipeline(Readable.fromWeb(response.body), async function* digest(chunks) {
      for await (const chunk of chunks) {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_MS);
        hash.update(chunk);
        yield chunk;
      }
    }, fs.createWriteStream(partial));
    const digest = hash.digest('hex');
    if (digest !== asset.sha256) throw new Error(`${asset.file} failed its checksum (${digest}).`);
    fs.renameSync(partial, target);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Kokoro download of ${asset.file} stalled for ${DOWNLOAD_IDLE_MS / 1000} seconds.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(idle);
    fs.rmSync(partial, { force: true });
  }
  return target;
}

function explicitIdentity(file) {
  const stat = fs.statSync(file);
  return `${path.resolve(file)}:${stat.size}:${stat.mtimeMs}`;
}

/**
 * Prepare the venv and model files; returns the interpreter and the model and voices paths.
 * `kokoroModel` and `kokoroVoices` select local files instead of the pinned downloads.
 */
export async function ensureKokoroEnv(cfg = {}) {
  const python = ensureVenv(kokoroVenvDir(), SPEC);
  const asset = kokoroModelAsset(cfg);
  const key = JSON.stringify([cfg.kokoroModel, cfg.kokoroVoices, asset.file]);
  if (prepared.has(key)) return prepared.get(key);
  for (const file of [cfg.kokoroModel, cfg.kokoroVoices].filter(Boolean)) {
    if (!fs.existsSync(file)) throw new Error(`Kokoro file not found: ${file}`);
  }
  const model = cfg.kokoroModel ? path.resolve(cfg.kokoroModel) : await download(asset, kokoroModelDir());
  const voices = cfg.kokoroVoices ? path.resolve(cfg.kokoroVoices) : await download(VOICES, kokoroModelDir());
  const result = { python, model, voices };
  prepared.set(key, result);
  return result;
}

/** Cache identity for a configuration without starting Python or downloading anything. */
export function kokoroIdentity(cfg = {}) {
  const local = (file, pinned) => (!file ? pinned : fs.existsSync(file) ? explicitIdentity(file) : path.resolve(file));
  return `${local(cfg.kokoroModel, kokoroModelAsset(cfg).sha256)}|${local(cfg.kokoroVoices, VOICES.sha256)}`;
}
