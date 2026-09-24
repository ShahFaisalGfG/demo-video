import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';
import { synthesize } from './synthesize.mjs';

/** Measure a decoded audio stream before accepting a cached clip. */
function clipDuration(file) {
  const info = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams',
    '-show_format', '-of', 'json', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const seconds = Number(info.format.duration);
  if (!info.streams.some((stream) => stream.codec_type === 'audio') || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid narration audio: ${file}`);
  }
  return Math.ceil(seconds * 1000);
}

/** Reuse clips only when speech, engine, voice, speed, and model identity match. */
export async function cachedNarration(text, output, config, cache) {
  const model = config.piperModel ? path.resolve(config.piperModel) : null;
  const identity = model && fs.existsSync(model)
    ? [fs.statSync(model).size, fs.statSync(model).mtimeMs,
      fs.existsSync(`${model}.json`) ? fs.readFileSync(`${model}.json`, 'utf8') : null]
    : null;
  const key = crypto.createHash('sha256').update(JSON.stringify({
    version: 2, text, engine: config.engine ?? 'piper',
    voice: config.piperVoice ?? 'en_US-ryan-medium', model, identity,
    speaker: config.piperSpeaker, tinySpeaker: config.speaker ?? 'MALE',
    speed: config.speed ?? 1, venv: config.venvDir,
  })).digest('hex');
  const cached = path.join(cache, `${key}.wav`);
  if (config.cacheNarration !== false && fs.existsSync(cached)) {
    try {
      const durationMs = clipDuration(cached);
      fs.copyFileSync(cached, output);
      return { durationMs, cached: true, engine: config.engine ?? 'piper' };
    } catch (error) {
      console.warn(`[narration] regenerating unreadable clip: ${error.message}`);
    }
  }
  const result = await synthesize(text, output, config);
  const durationMs = clipDuration(output);
  if (config.cacheNarration !== false && result.engine === (config.engine ?? 'piper')) {
    fs.mkdirSync(cache, { recursive: true });
    fs.copyFileSync(output, cached);
  }
  return { durationMs, cached: false, ...result };
}
