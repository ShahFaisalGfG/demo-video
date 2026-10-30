// Narration audio verification. Transcribes every narration clip of one or
// more recording definitions with faster-whisper and compares the words with
// the captions; with --video it also transcribes the finished soundtrack and
// checks the whole script in order, plus each caption's start against where
// it was heard when --srt is given. Words spelled alike but said differently
// (read, record, live) are listed with their phonemes for tense and stress review.
//
// Usage: node verify-narration.mjs <recording.json>... [--video final.mp4] [--srt final.srt]
//   [--model large-v3-turbo] [--max-offset 1.0] [--report report.json] [--no-phonemes] [--report-only]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { demoVideoHome, projectCacheDir } from './lib/npm-env.mjs';
import { alignEnvironment, ensureAlignEnv } from './lib/align-venv.mjs';
import { parseSrt } from './lib/captions.mjs';
import { kokoroLanguage, kokoroVenvDir } from './lib/kokoro-env.mjs';
import { venvPython, venvReady } from './lib/python-venv.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const VALUE_OPTIONS = new Set(['--video', '--srt', '--model', '--max-offset', '--report']);

function parseArguments(argv) {
  const options = { definitions: [], model: 'large-v3-turbo', maxOffset: 1 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (VALUE_OPTIONS.has(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value.`);
      const key = argument.slice(2).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
      options[key] = key === 'maxOffset' ? Number(value) : value;
    } else if (argument === '--no-phonemes') options.noPhonemes = true;
    else if (argument === '--report-only') options.reportOnly = true;
    else options.definitions.push(argument);
  }
  if (!options.definitions.length) throw new Error('Pass at least one recording definition.');
  if (!Number.isFinite(options.maxOffset) || options.maxOffset <= 0) throw new Error('--max-offset must be positive.');
  if (options.srt && !options.video) throw new Error('--srt checks the finished soundtrack; pass --video as well.');
  return options;
}

/** Narrated clips of a definition, refusing a manifest that no longer matches its definition. */
function loadClips(definitionPath, projectCache) {
  const name = path.basename(definitionPath).replace(/\.recording\.json$/, '');
  const manifestPath = path.join(projectCache, name, 'narration-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No narration for ${definitionPath}. Run generate-narration.mjs first.`);
  const { manifest, definitionHash } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (definitionHash !== crypto.createHash('sha256').update(fs.readFileSync(definitionPath)).digest('hex')) {
    throw new Error(`Narration for ${definitionPath} is stale. Run generate-narration.mjs again.`);
  }
  return manifest.filter((entry) => entry.narrated)
    .map((entry, index) => ({ name: `${name}#${index}`, audio: entry.audioPath, text: entry.text, spoken: entry.spokenText }));
}

function runPython(python, script, input, output, env) {
  fs.writeFileSync(input.path, JSON.stringify(input.data, null, 2));
  execFileSync(python, ['-I', path.join(scripts, script), input.path, output], { stdio: 'inherit', env });
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

function verify(options) {
  const projectCache = projectCacheDir(demoVideoHome());
  const work = path.join(projectCache, 'narration-verification');
  fs.mkdirSync(work, { recursive: true });
  const definitions = options.definitions.map((file) => path.resolve(file));
  const configs = definitions.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')).narrationConfig ?? {});
  const clips = definitions.flatMap((file) => loadClips(file, projectCache));
  const cues = options.srt
    ? parseSrt(fs.readFileSync(options.srt, 'utf8')).map((cue) => ({ text: cue.text, start: cue.start }))
    : clips.map((clip) => ({ text: clip.text, start: null }));
  const { pythonBin } = ensureAlignEnv();
  console.log(`[verify-narration] transcribing ${clips.length} clip(s)${options.video ? ' and the soundtrack' : ''} `
    + `with ${options.model}; the first run downloads the model.`);
  const report = runPython(pythonBin, 'verify-narration.py', {
    path: path.join(work, 'request.json'),
    data: { model: options.model, clips, video: options.video ? path.resolve(options.video) : null, cues,
      maxOffset: options.maxOffset, equivalents: Object.assign({}, ...configs.map((cfg) => cfg.asrEquivalents ?? {})) },
  }, path.join(work, 'asr-report.json'), alignEnvironment());
  if (options.noPhonemes) report.phonemes = 'skipped';
  else if (venvReady(kokoroVenvDir(), ['kokoro_onnx'])) {
    console.log('[verify-narration] words spelled alike but said differently (espeak-ng phonemes):');
    report.phonemes = runPython(venvPython(kokoroVenvDir()), 'narration-phonemes.py', {
      path: path.join(work, 'phoneme-request.json'),
      data: { lang: kokoroLanguage(configs[0]), lines: clips.map(({ name, spoken }) => ({ name, spoken })) },
    }, path.join(work, 'phonemes.json'));
  } else report.phonemes = 'unavailable: the Kokoro environment is not installed';
  const failedClips = report.clips.filter((clip) => clip.differences.length);
  report.passed = !failedClips.length && report.soundtrack?.passed !== false;
  const reportPath = path.resolve(options.report ?? path.join(work, 'narration-verification.json'));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[verify-narration] ${report.clips.length - failedClips.length} of ${report.clips.length} clip(s) match`
    + `${report.soundtrack ? `; soundtrack ${report.soundtrack.passed ? 'matches' : 'differs'}` : ''}. Report: ${reportPath}`);
  return report.passed;
}

if (process.argv.length < 3 || process.argv.includes('--help')) {
  console.log('Usage: node verify-narration.mjs <recording.json>... [--video final.mp4] [--srt final.srt] '
    + '[--model large-v3-turbo] [--max-offset 1.0] [--report report.json] [--no-phonemes] [--report-only]');
  process.exit(process.argv.includes('--help') ? 0 : 1);
}
const options = parseArguments(process.argv.slice(2));
if (!verify(options) && !options.reportOnly) process.exit(1);
