import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { synthesize } from './synthesize.mjs';
import { prepareNarration } from './narration-text.mjs';
import { alignEnvReady, alignPython, ensureAlignEnv } from './align-venv.mjs';
import { demoVideoHome } from './npm-env.mjs';

function candidateId(candidate, index) {
  return candidate.id ?? candidate.label ?? candidate.piperVoice ?? candidate.speaker ?? `candidate-${index + 1}`;
}

function pcmMetrics(file, wordCount) {
  const buffer = fs.readFileSync(file);
  const formatOffset = buffer.indexOf(Buffer.from('fmt '));
  const dataOffset = buffer.indexOf(Buffer.from('data'));
  if (formatOffset < 0 || dataOffset < 0) throw new Error(`WAV format or data chunk missing in ${file}.`);
  const format = buffer.readUInt16LE(formatOffset + 8);
  const channels = buffer.readUInt16LE(formatOffset + 10);
  const sampleRate = buffer.readUInt32LE(formatOffset + 12);
  const bits = buffer.readUInt16LE(formatOffset + 22);
  const dataLength = buffer.readUInt32LE(dataOffset + 4);
  const data = buffer.subarray(dataOffset + 8, dataOffset + 8 + dataLength);
  const bytesPerSample = bits / 8;
  if (!((format === 1 && bits === 16) || (format === 3 && bits === 32))) {
    throw new Error(`Voice scoring supports PCM16 or float32 WAV, received format ${format}/${bits}.`);
  }
  let squares = 0;
  let clipping = 0;
  let silence = 0;
  const samples = Math.floor(data.length / bytesPerSample);
  for (let offset = 0; offset + bytesPerSample - 1 < data.length; offset += bytesPerSample) {
    const value = format === 1 ? data.readInt16LE(offset) / 32768 : data.readFloatLE(offset);
    squares += value * value;
    if (Math.abs(value) >= 0.98) clipping++;
    if (Math.abs(value) <= 0.012) silence++;
  }
  const duration = samples / Math.max(1, sampleRate * channels);
  const rms = Math.sqrt(squares / Math.max(1, samples));
  const dbfs = 20 * Math.log10(Math.max(rms, 1e-8));
  const clippingRatio = clipping / Math.max(1, samples);
  const silenceRatio = silence / Math.max(1, samples);
  const wordsPerSecond = wordCount / Math.max(0.1, duration);
  const levelScore = Math.max(0, 1 - Math.abs(dbfs + 18) / 18);
  const clipScore = Math.max(0, 1 - clippingRatio * 200);
  const silenceScore = Math.max(0, 1 - Math.max(0, silenceRatio - 0.28) / 0.5);
  const paceScore = Math.max(0, 1 - Math.abs(wordsPerSecond - 2.6) / 2.6);
  return {
    duration, dbfs, clipping: clippingRatio, silence: silenceRatio, wordsPerSecond,
    acousticScore: levelScore * 0.35 + clipScore * 0.35 + silenceScore * 0.15 + paceScore * 0.15,
  };
}

function modelCached(modelDir, model) {
  const hub = path.join(modelDir, 'hub');
  if (!fs.existsSync(hub)) return false;
  const token = model.replaceAll('/', '--').replaceAll('.', '-').toLowerCase();
  return fs.readdirSync(hub).some((entry) => entry.toLowerCase().replaceAll('.', '-').includes(token));
}

function selectionText(lines, config) {
  if (config.voiceSelection?.sampleText) return config.voiceSelection.sampleText;
  const maximumWords = config.voiceSelection?.sampleWords ?? 42;
  return lines.join(' ').split(/\s+/).slice(0, maximumWords).join(' ');
}

export async function selectVoice(config, narrationLines, projectCache, definitionDir) {
  const candidates = config.voiceCandidates ?? [];
  if (candidates.length < 2) return { config, report: null };
  const rawSample = selectionText(narrationLines, config);
  const prepared = prepareNarration(rawSample, config, definitionDir);
  const mode = config.voiceSelection?.mode ?? 'cached-asr';
  const model = config.voiceSelection?.asrModel ?? 'tiny.en';
  const hash = crypto.createHash('sha256').update(JSON.stringify({
    sample: prepared.spokenText,
    config,
    candidates,
    mode,
    model,
  })).digest('hex').slice(0, 16);
  const selectionDir = path.join(projectCache, 'voice-selections', hash);
  const reportPath = path.join(selectionDir, 'report.json');
  const modelDir = path.join(demoVideoHome(), '.demovideo_align_models');
  const canUseCachedAsr = alignEnvReady() && modelCached(modelDir, model);
  fs.mkdirSync(selectionDir, { recursive: true });
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const selectedIndex = candidates.findIndex((candidate, index) => candidateId(candidate, index) === report.selected);
    const shouldUpgrade = (mode === 'verified' || (mode === 'cached-asr' && canUseCachedAsr))
      && report.mode !== 'asr-and-acoustic';
    if (selectedIndex >= 0 && !shouldUpgrade) return {
      config: { ...config, ...candidates[selectedIndex], selectedVoice: report.selected },
      report: { ...report, cached: true },
    };
  }

  const base = { ...config };
  delete base.voiceCandidates;
  delete base.voiceSelection;
  const scoredCandidates = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const id = candidateId(candidate, index);
    const audioPath = path.join(selectionDir, `${String(index + 1).padStart(2, '0')}.wav`);
    if (!fs.existsSync(audioPath)) await synthesize(prepared.spokenText, audioPath, { ...base, ...candidate });
    scoredCandidates.push({ id, path: audioPath, wordCount: prepared.spokenText.split(/\s+/).length,
      ...pcmMetrics(audioPath, prepared.spokenText.split(/\s+/).length) });
  }

  const useAsr = mode === 'verified' || (mode === 'cached-asr' && canUseCachedAsr);
  let report;
  if (useAsr) {
    const { pythonBin } = mode === 'verified' ? ensureAlignEnv() : { pythonBin: alignPython() };
    const manifestPath = path.join(selectionDir, 'score-input.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      expected: prepared.spokenText,
      model,
      modelDir,
      candidates: scoredCandidates.map(({ id, path: audioPath, wordCount }) => ({ id, path: audioPath, wordCount })),
    }, null, 2));
    const scorer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'score-voices.py');
    execFileSync(pythonBin, [scorer, manifestPath, reportPath], {
      stdio: 'inherit',
      env: { ...process.env, HF_HOME: modelDir, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
    });
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.mode = 'asr-and-acoustic';
  } else {
    const results = scoredCandidates.map((candidate) => ({ ...candidate, score: candidate.acousticScore }))
      .sort((left, right) => right.score - left.score);
    report = { selected: results[0].id, mode: 'acoustic-fast', results };
  }
  report.sampleText = prepared.displayText;
  report.spokenText = prepared.spokenText;
  report.cached = false;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const selectedIndex = candidates.findIndex((candidate, index) => candidateId(candidate, index) === report.selected);
  return {
    config: { ...config, ...candidates[selectedIndex], selectedVoice: report.selected },
    report,
  };
}
