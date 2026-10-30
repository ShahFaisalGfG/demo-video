// Local text-to-speech abstraction.
//
// Kokoro v1.0 is the primary engine and defaults to the am_michael US English
// male voice with the full-precision model. One Kokoro worker process serves a
// whole narration batch, so the model loads once. Piper is the second engine,
// selected with engine "piper" or allowed as fallbackEngine. TinyTTS remains an
// explicit last-resort fallback. A failure never changes voices unless the
// definition names a fallback engine.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensurePiperEnv } from './piper-venv.mjs';
import { DEFAULT_KOKORO_VOICE, ensureKokoroEnv, kokoroLanguage } from './kokoro-env.mjs';

export const ENGINES = ['kokoro', 'piper', 'tiny-tts'];
export const DEFAULT_ENGINE = 'kokoro';
const DEFAULT_PIPER_VOICE = 'en_US-ryan-medium';
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kokoro-worker.py');
// The model load and one clip each take seconds; a worker silent this long is stalled and is stopped.
const KOKORO_START_MS = 180_000;
const KOKORO_CLIP_MS = 120_000;

let tinyTtsInstance;
let kokoroWorker;

async function getTinyTts() {
  if (!tinyTtsInstance) {
    const { default: TinyTTS } = await import('tiny-tts');
    tinyTtsInstance = new TinyTTS();
  }
  return tinyTtsInstance;
}

async function synthesizeWithTinyTts(text, outPath, { speaker = 'MALE', speed = 1.0 } = {}) {
  const tts = await getTinyTts();
  await tts.speak(text, { output: outPath, speaker, speed });
}

function ensurePiperModel(voiceDir, pythonBin, voice) {
  const modelPath = path.join(voiceDir, `${voice}.onnx`);
  const configPath = `${modelPath}.json`;
  if (fs.existsSync(modelPath) && fs.existsSync(configPath)) return modelPath;

  fs.mkdirSync(voiceDir, { recursive: true });
  console.log(`[synthesize] downloading piper voice "${voice}" (one-time, ~60MB)...`);
  execFileSync(pythonBin, ['-m', 'piper.download_voices', voice, '--download-dir', voiceDir], {
    stdio: 'inherit',
  });
  return modelPath;
}

function synthesizeWithPiper(text, outPath, cfg = {}) {
  const { piperVoice = DEFAULT_PIPER_VOICE, piperModel, piperSpeaker } = cfg;
  const { piperBin, pythonBin, venvDir } = ensurePiperEnv(cfg);
  const voiceDir = path.join(path.dirname(venvDir), '.demovideo_voices');
  const modelPath = piperModel || ensurePiperModel(voiceDir, pythonBin, piperVoice);

  const args = ['--model', modelPath, '--output_file', outPath,
    '--length-scale', String(1 / (cfg.speed ?? 1))];
  if (piperSpeaker !== undefined) args.push('--speaker', String(piperSpeaker));
  execFileSync(piperBin, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
}

function readReply(worker, line) {
  if (!line.startsWith('{')) return;
  let reply;
  try {
    reply = JSON.parse(line);
  } catch {
    return;
  }
  if (reply.ready) {
    worker.started(reply.voices);
    return;
  }
  const job = worker.pending.get(reply.id);
  if (!job) return;
  worker.pending.delete(reply.id);
  if (reply.ok) job.resolve(reply);
  else job.reject(new Error(reply.error));
}

/** Start one Kokoro worker for a model; it answers JSON lines until disposeSynthesizer closes it. */
async function startKokoro(cfg) {
  const { python, model, voices } = await ensureKokoroEnv(cfg);
  if (kokoroWorker?.model === model && kokoroWorker.voices === voices) return kokoroWorker;
  await disposeKokoro();
  const child = spawn(python, ['-I', WORKER, model, voices], { stdio: ['pipe', 'pipe', 'inherit'] });
  const worker = { model, voices, child, pending: new Map(), sequence: 0 };
  worker.ready = new Promise((resolve, reject) => {
    worker.started = resolve;
    worker.failed = reject;
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => readReply(worker, line));
  const stop = (error) => {
    worker.failed(error);
    for (const job of worker.pending.values()) job.reject(error);
    worker.pending.clear();
    if (kokoroWorker === worker) kokoroWorker = undefined;
  };
  child.once('error', stop);
  child.stdin.on('error', stop);
  child.once('exit', (code) => stop(new Error(`Kokoro worker exited with code ${code}.`)));
  kokoroWorker = worker;
  await withTimeout(worker.ready, KOKORO_START_MS, worker, 'Kokoro did not load its model');
  return worker;
}

/** Wait for a worker promise; on timeout stop the worker so no clip waits forever. */
async function withTimeout(promise, ms, worker, message) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      worker.child.kill();
      reject(new Error(`${message} within ${ms / 1000} seconds.`));
    }, ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeWithKokoro(text, outPath, cfg = {}) {
  const worker = await startKokoro(cfg);
  const id = ++worker.sequence;
  const reply = new Promise((resolve, reject) => worker.pending.set(id, { resolve, reject }));
  worker.child.stdin.write(`${JSON.stringify({
    id, text, output: path.resolve(outPath), voice: cfg.kokoroVoice ?? DEFAULT_KOKORO_VOICE,
    speed: cfg.speed ?? 1, lang: kokoroLanguage(cfg),
  })}\n`);
  await withTimeout(reply, KOKORO_CLIP_MS, worker, 'Kokoro did not finish a clip');
}

/** Voice label recorded in manifests and reports for an engine. */
export function voiceLabel(engine, cfg = {}) {
  if (engine === 'kokoro') return cfg.kokoroVoice ?? DEFAULT_KOKORO_VOICE;
  if (engine === 'piper') return cfg.piperModel ? path.basename(cfg.piperModel) : cfg.piperVoice ?? DEFAULT_PIPER_VOICE;
  return cfg.speaker ?? 'MALE';
}

async function runEngine(engine, text, outPath, cfg) {
  if (engine === 'kokoro') await synthesizeWithKokoro(text, outPath, cfg);
  else if (engine === 'piper') synthesizeWithPiper(text, outPath, cfg);
  else await synthesizeWithTinyTts(text, outPath, cfg);
}

/** Generate one WAV narration clip with the configured engine, or its explicitly named fallback. */
export async function synthesize(text, outPath, cfg = {}) {
  const engine = cfg.engine ?? DEFAULT_ENGINE;
  const fallback = cfg.fallbackEngine ?? null;
  const speed = cfg.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Narration speed must be a positive number.');
  if (!ENGINES.includes(engine)) throw new Error(`Unsupported narration engine "${engine}". Use ${ENGINES.join(', ')}.`);
  if (fallback !== null && (!ENGINES.includes(fallback) || fallback === engine)) {
    throw new Error(`fallbackEngine must be null or another engine (${ENGINES.join(', ')}).`);
  }
  try {
    await runEngine(engine, text, outPath, cfg);
    return { engine, voice: voiceLabel(engine, cfg) };
  } catch (error) {
    if (!fallback) {
      throw new Error(`${engine} narration failed. Repair it or explicitly set fallbackEngine.`, { cause: error });
    }
    console.warn(`[synthesize] ${engine} failed (${error.message}); falling back to ${fallback}.`);
  }
  await runEngine(fallback, text, outPath, cfg);
  return { engine: fallback, voice: voiceLabel(fallback, cfg) };
}

async function disposeKokoro() {
  const worker = kokoroWorker;
  if (!worker) return;
  kokoroWorker = undefined;
  await new Promise((resolve) => {
    if (worker.child.exitCode !== null) {
      resolve();
      return;
    }
    worker.child.once('exit', resolve);
    worker.child.stdin.end();
  });
}

/** Release the Kokoro worker and the TinyTTS model after a narration batch completes. */
export async function disposeSynthesizer() {
  await disposeKokoro();
  if (tinyTtsInstance) {
    await tinyTtsInstance.dispose();
    tinyTtsInstance = undefined;
  }
}
