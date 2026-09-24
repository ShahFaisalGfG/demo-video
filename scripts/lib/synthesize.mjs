// Local text-to-speech abstraction.
//
// Piper is the primary engine and defaults to the Ryan US English male voice.
// It runs from the isolated, self-healing environment managed by
// piper-venv.mjs. Voice models are cached once under ~/.demo_video and reused
// across projects. TinyTTS is an explicitly selected fallback.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensurePiperEnv } from './piper-venv.mjs';

const DEFAULT_PIPER_VOICE = 'en_US-ryan-medium';

let tinyTtsInstance;

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

/** Generate one WAV narration clip with Piper or the TinyTTS fallback. */
export async function synthesize(text, outPath, cfg = {}) {
  const engine = cfg.engine ?? 'piper';
  const speed = cfg.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Narration speed must be a positive number.');
  if (cfg.fallbackEngine != null && cfg.fallbackEngine !== 'tiny-tts') {
    throw new Error('fallbackEngine must be null or "tiny-tts".');
  }

  if (engine === 'piper') {
    try {
      synthesizeWithPiper(text, outPath, cfg);
      return { engine: 'piper', voice: cfg.piperVoice ?? DEFAULT_PIPER_VOICE };
    } catch (error) {
      if (cfg.fallbackEngine !== 'tiny-tts') {
        throw new Error('Piper narration failed. Repair Piper or explicitly set fallbackEngine to "tiny-tts".', { cause: error });
      }
      console.warn(`[synthesize] piper unavailable/failed (${error.message}); falling back to tiny-tts.`);
    }
  } else if (engine !== 'tiny-tts') {
    throw new Error(`Unsupported narration engine "${engine}". Use "piper" or "tiny-tts".`);
  }

  await synthesizeWithTinyTts(text, outPath, cfg);
  return { engine: 'tiny-tts', voice: cfg.speaker ?? 'MALE' };
}

/** Release the fallback synthesizer after a narration batch completes. */
export async function disposeSynthesizer() {
  if (tinyTtsInstance) {
    await tinyTtsInstance.dispose();
    tinyTtsInstance = undefined;
  }
}
