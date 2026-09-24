import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { browsersDir, demoVideoHome } from './lib/npm-env.mjs';
import { prepareNarration } from './lib/narration-text.mjs';
import { selectEncoder } from './lib/encoder.mjs';
import { masterAudio } from './lib/audio-mastering.mjs';
import { selectVoice } from './lib/voice-selection.mjs';
import { disposeSynthesizer } from './lib/synthesize.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-video-self-test-'));
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir(demoVideoHome());
const pageHtml = '<label><input id="flag" type="checkbox">Enable</label>' +
  '<button id="go" onclick="fetch(\'/api\',{method:\'POST\'}).then(()=>' +
  'document.getElementById(\'status\').textContent=\'Done\')">Run</button><h1 id="status">Ready</h1>';
const server = http.createServer((request, response) => {
  if (request.url === '/v1/chat/completions' && request.method === 'POST') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content:
      '{"passed":true,"confidence":0.98,"observed":"Done is visible","reason":"The expected state is shown."}' } }] }));
    return;
  }
  if (request.url === '/api' && request.method === 'POST') {
    response.writeHead(202, { 'Content-Type': 'application/json' });
    response.end('{"accepted":true}');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(pageHtml);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const selfTestUrl = `http://127.0.0.1:${address.port}`;

function duration(file) {
  return Number(execFileSync(ffprobeStatic.path, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Node child exited with code ${code}.`)));
  });
}

try {
  const definitionPath = path.join(root, 'self-test.recording.json');
  fs.writeFileSync(definitionPath, JSON.stringify({
    url: selfTestUrl,
    viewport: { width: 800, height: 500 },
    outputFormat: 'mp4',
    steps: [
      { action: 'check', selector: '#flag' },
      { action: 'assert', selector: '#flag', kind: 'checked' },
      { action: 'if', condition: { selector: '#flag', state: 'checked' },
        then: [{ action: 'clickResponse', selector: '#go', urlPattern: '/api', method: 'POST', status: 202 }] },
      { action: 'assert', selector: '#status', kind: 'text', text: 'Done' },
    ],
  }, null, 2));
  const { recordDefinition } = await import('./lib/recorder-adapter.mjs');
  const recorded = await recordDefinition(definitionPath, { outputDir: path.join(root, 'recorded'), clean: true });
  if (!fs.existsSync(recorded.video) || duration(recorded.video) < 2) throw new Error('Owned adapter output is invalid.');

  const prepared = prepareNarration('Import CSV and XML through the API.', {});
  if (!prepared.spokenText.includes('C S V') || !prepared.spokenText.includes('A P I')) {
    throw new Error('Pronunciation dictionary was not applied.');
  }
  const encoder = selectEncoder('auto');
  const voiceMode = process.argv.includes('--with-asr') ? 'cached-asr' : 'fast';
  const voiceResult = await selectVoice({
    engine: 'tiny-tts',
    voiceCandidates: [
      { id: 'male', speaker: 'MALE' },
      { id: 'female', speaker: 'FEMALE' },
    ],
    voiceSelection: { mode: voiceMode, sampleWords: 12 },
  }, ['Import CSV and XML through the API.'], root, root);
  if (!voiceResult.report?.selected) throw new Error('Voice candidate selection failed.');
  if (process.argv.includes('--with-asr') && voiceResult.report.mode !== 'asr-and-acoustic') {
    throw new Error('ASR voice scoring was requested but not used.');
  }
  const cachedVoice = await selectVoice({
    engine: 'tiny-tts',
    voiceCandidates: [
      { id: 'male', speaker: 'MALE' },
      { id: 'female', speaker: 'FEMALE' },
    ],
    voiceSelection: { mode: voiceMode, sampleWords: 12 },
  }, ['Import CSV and XML through the API.'], root, root);
  if (!cachedVoice.report?.cached) throw new Error('Voice selection cache was not reused.');
  await disposeSynthesizer();
  const narrationTone = path.join(root, 'narration-tone.wav');
  const masteredTone = path.join(root, 'narration-mastered.wav');
  execFileSync(ffmpegStatic, ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=22050',
    '-t', '2', '-c:a', 'pcm_s16le', '-y', narrationTone], { stdio: 'ignore' });
  masterAudio(narrationTone, masteredTone, 22050);
  if (!fs.existsSync(masteredTone) || duration(masteredTone) < 1.9) throw new Error('Audio mastering failed.');
  const source = path.join(root, 'source.mp4');
  execFileSync(ffmpegStatic, ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8',
    '-c:v', 'libx264', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source],
  { stdio: 'ignore' });
  const overlay = path.join(root, 'overlay.png');
  execFileSync(ffmpegStatic, ['-f', 'lavfi', '-i', 'color=c=red:size=180x100',
    '-frames:v', '1', '-update', '1', '-y', overlay], { stdio: 'ignore' });
  const patches = path.join(root, 'patches.json');
  fs.writeFileSync(patches, JSON.stringify([{ image: overlay, start: 3.2, end: 4.1, x: 25, y: 25 }]));
  const patched = path.join(root, 'patched.mp4');
  execFileSync(process.execPath, [path.join(scriptsDir, 'patch-video-gop.mjs'), source, patches, patched, 'libx264'],
    { stdio: 'inherit' });
  if (!fs.existsSync(patched) || Math.abs(duration(patched) - duration(source)) > 0.35) {
    throw new Error('GOP patch output is invalid.');
  }
  const pacingReport = path.join(root, 'pacing.json');
  execFileSync(process.execPath, [path.join(scriptsDir, 'analyze-pacing.mjs'), patched, '', pacingReport],
    { stdio: 'inherit' });
  const pacing = JSON.parse(fs.readFileSync(pacingReport, 'utf8'));
  if (!Number.isFinite(pacing.score) || pacing.sampledFrames < 2) throw new Error('Pacing analysis failed.');
  const semanticChecks = path.join(root, 'semantic.json');
  fs.writeFileSync(semanticChecks, JSON.stringify({
    baseUrl: `${selfTestUrl}/v1`,
    model: 'mock-vlm',
    checks: [{ name: 'completed', timestamp: 3, claim: 'The completed state is visible.' }],
  }));
  const semanticReport = path.join(root, 'semantic-report.json');
  await runNode([path.join(scriptsDir, 'verify-semantic-evidence.mjs'), recorded.video,
    semanticChecks, semanticReport]);
  if (!JSON.parse(fs.readFileSync(semanticReport, 'utf8')).passed) throw new Error('Semantic evidence failed.');

  if (process.argv.includes('--with-ocr')) {
    const checks = path.join(root, 'visual.json');
    fs.writeFileSync(checks, JSON.stringify([{ name: 'completed', timestamp: 3, expectedText: ['Done'] }]));
    execFileSync(process.execPath, [path.join(scriptsDir, 'verify-visual-evidence.mjs'), recorded.video,
      checks, path.join(root, 'visual-report.json')], { stdio: 'inherit' });
  }
  console.log(`[self-test] passed on ${process.platform}; encoder probe selected ${encoder.name}.`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`[self-test] temporary cleanup deferred: ${error.message}`);
  }
}
