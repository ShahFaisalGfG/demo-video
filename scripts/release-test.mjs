import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { parseSrt, formatSrt, formatAss } from './lib/captions.mjs';
import { editTimeline, retimeCues } from './lib/edit-timeline.mjs';
import { cachedNarration } from './lib/narration-cache.mjs';
import { synthesize, disposeSynthesizer } from './lib/synthesize.mjs';
import { systemPython } from './lib/python-venv.mjs';
import { checkForUpdate, compareVersions, verifySignature } from './lib/update-check.mjs';
import { updateSkill } from './update-skill.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-release-test-'));
const scripts = path.dirname(fileURLToPath(import.meta.url));

/** Run a bundled command inside the disposable test workspace. */
function runScript(name, ...args) {
  return execFileSync(process.execPath, [path.join(scripts, name), ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
}

/** Measure encoded stream duration for observable timing assertions. */
function duration(file) {
  return Number(execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file], { encoding: 'utf8' }));
}

/** Hash a compressed stream to verify copy paths and paired audio identity. */
function streamHash(file, kind) {
  return execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', `0:${kind}:0`, '-c', 'copy',
    '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim();
}

/**
 * Check signed updates against a local release server: an ephemeral key stands in for the release
 * key and a disposable home folder for the user's, so nothing reaches the network or real installs.
 */
async function testSignedUpdates(workspace) {
  const keyPair = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const signer = keyPair();
  const stranger = keyPair();
  const sign = (data, key = signer.privateKey) =>
    `${crypto.sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' }).toString('base64')}\n`;

  const sample = Buffer.from('{"name":"demo-video"}\n');
  assert.ok(verifySignature(sample, sign(sample), [signer.publicKey]));
  assert.ok(verifySignature(sample, sign(sample), [stranger.publicKey, signer.publicKey]), 'a rotated key list');
  assert.ok(!verifySignature(Buffer.from('{"name":"demo-videO"}\n'), sign(sample), [signer.publicKey]), 'tampered data');
  assert.ok(!verifySignature(sample, sign(sample), [stranger.publicKey]), 'wrong key');
  assert.ok(!verifySignature(sample, sign(sample, stranger.privateKey), [signer.publicKey]), 'signed by another key');
  assert.ok(!verifySignature(sample, 'bm90IGEgc2lnbmF0dXJl\n', [signer.publicKey]), 'short signature');
  assert.ok(!verifySignature(sample, sign(sample), []), 'no trusted keys');

  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
  assert.ok(compareVersions('1.7.0', '1.7.1') < 0);
  assert.equal(compareVersions('1.7.0', '1.7.0'), 0);
  for (const invalid of ['1.7', 'v1.7.0', '1.7.0-beta', '']) assert.throws(() => compareVersions(invalid, '1.7.0'), /X\.Y\.Z/);

  const updateRoot = path.join(workspace, 'update');
  const stage = path.join(updateRoot, 'stage', 'demo-video');
  fs.cpSync(scripts, path.join(stage, 'scripts'), { recursive: true, filter: (source) => path.basename(source) !== '__pycache__' });
  fs.writeFileSync(path.join(stage, 'SKILL.md'), '---\nname: demo-video\n---\n');
  fs.writeFileSync(path.join(stage, 'VERSION'), '9.0.0\n');
  const releaseDir = path.join(updateRoot, 'release');
  execFileSync(systemPython('the update test'), ['-I', path.join(scripts, 'package-skill.py'), stage, releaseDir], { stdio: 'ignore' });
  const manifestBytes = fs.readFileSync(path.join(releaseDir, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const assets = new Map();
  const publish = (data, signature = sign(data)) => {
    assets.set('release-manifest.json', data);
    assets.set('release-manifest.json.sig', Buffer.from(signature));
  };
  assets.set(manifest.archive, fs.readFileSync(path.join(releaseDir, manifest.archive)));
  publish(manifestBytes);

  // Mirrors GitHub: the latest-release link redirects to the tagged download.
  const served = [];
  const server = http.createServer((request, response) => {
    served.push(request.url);
    const latest = /^\/releases\/latest\/download\/([^/]+)$/.exec(request.url);
    if (latest) {
      response.writeHead(302, { Location: `/releases/download/v${manifest.version}/${latest[1]}` });
      response.end();
      return;
    }
    const tagged = new RegExp(`^/releases/download/v${manifest.version}/([^/]+)$`).exec(request.url);
    const body = tagged && assets.get(tagged[1]);
    response.writeHead(body ? 200 : 404);
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const releasesUrl = `http://127.0.0.1:${server.address().port}/releases`;

  const home = path.join(updateRoot, 'home');
  const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'CODEX_HOME', 'DEMO_VIDEO_NO_UPDATE_CHECK']
    .map((name) => [name, process.env[name]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') });
  delete process.env.DEMO_VIDEO_NO_UPDATE_CHECK;
  try {
    const cacheFile = path.join(updateRoot, 'update-check.json');
    const options = { releasesUrl, publicKeys: [signer.publicKey], cacheFile };
    const offered = await checkForUpdate('1.7.0', options);
    assert.deepEqual([offered.status, offered.latest], ['update-available', '9.0.0']);
    let requests = served.length;
    assert.equal((await checkForUpdate('1.7.0', options)).status, 'update-available');
    assert.equal(served.length, requests, 'a fresh saved check is reused without a request');
    assert.equal((await checkForUpdate('9.0.0', options)).status, 'up-to-date');
    assert.ok(served.length > requests, 'another installed version checks again');
    requests = served.length;
    const dayOld = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(cacheFile, dayOld, dayOld);
    await checkForUpdate('9.0.0', options);
    assert.ok(served.length > requests, 'a saved check older than a day is repeated');
    requests = served.length;
    const momentAhead = (Date.now() + 500) / 1000;
    fs.utimesSync(cacheFile, momentAhead, momentAhead);
    await checkForUpdate('9.0.0', options);
    assert.equal(served.length, requests, 'a file time a moment ahead of the clock still counts');
    const hourAhead = (Date.now() + 60 * 60 * 1000) / 1000;
    fs.utimesSync(cacheFile, hourAhead, hourAhead);
    await checkForUpdate('9.0.0', options);
    assert.ok(served.length > requests, 'a file time far ahead of the clock is checked again');

    fs.rmSync(cacheFile);
    publish(Buffer.from(manifestBytes.toString().replace('"9.0.0"', '"9.0.1"')), sign(manifestBytes));
    assert.equal((await checkForUpdate('1.7.0', options)).status, 'unverified', 'a tampered manifest is not offered');
    fs.rmSync(cacheFile);
    publish(manifestBytes, sign(manifestBytes, stranger.privateKey));
    assert.equal((await checkForUpdate('1.7.0', options)).status, 'unverified', 'a manifest signed by another key');
    fs.rmSync(cacheFile);
    assert.equal((await checkForUpdate('1.7.0', { ...options, releasesUrl: `${releasesUrl}/missing` })).status, 'failed');
    requests = served.length;
    assert.equal((await checkForUpdate('1.7.0', { ...options, publicKeys: [] })).status, 'not-configured');
    process.env.DEMO_VIDEO_NO_UPDATE_CHECK = '1';
    assert.equal((await checkForUpdate('1.7.0', options)).status, 'disabled');
    delete process.env.DEMO_VIDEO_NO_UPDATE_CHECK;
    assert.equal(served.length, requests, 'an unconfigured or disabled check makes no request');

    const claudeRoot = path.join(home, '.claude', 'skills');
    const outdated = path.join(claudeRoot, 'demo-video');
    fs.mkdirSync(outdated, { recursive: true });
    fs.writeFileSync(path.join(outdated, 'VERSION'), '1.7.0\n');
    fs.writeFileSync(path.join(outdated, 'previous-only.txt'), 'previous copy');
    // Up to 1.6.1 a backup stayed beside the installed copy, where hosts load it as a second skill.
    const backupsRoot = path.join(home, '.demo_video', 'backups');
    fs.mkdirSync(path.join(claudeRoot, 'demo-video.backup-2020-01-01T00-00-00-000Z'));
    fs.mkdirSync(path.join(backupsRoot, 'claude', 'demo-video.backup-2021-01-01T00-00-00-000Z'), { recursive: true });
    const current = path.join(home, '.agents', 'skills', 'demo-video');
    fs.mkdirSync(current, { recursive: true });
    fs.writeFileSync(path.join(current, 'VERSION'), '9.0.0\n');
    const unversioned = path.join(home, '.codex', 'skills', 'demo-video');
    fs.mkdirSync(unversioned, { recursive: true });
    const updateOptions = { releasesUrl, publicKeys: [signer.publicKey] };

    const wrongChecksum = Buffer.from(manifestBytes.toString().replace(manifest.sha256, '0'.repeat(64)));
    publish(wrongChecksum);
    await assert.rejects(updateSkill(updateOptions), /failed its checksum/);
    publish(manifestBytes, sign(manifestBytes, stranger.privateKey));
    await assert.rejects(updateSkill(updateOptions), /valid signature/);
    assert.equal(fs.readFileSync(path.join(outdated, 'VERSION'), 'utf8').trim(), '1.7.0', 'a refused update changes nothing');

    publish(manifestBytes);
    const result = await updateSkill(updateOptions);
    assert.deepEqual(result.updated.map((copy) => copy.host), ['claude']);
    assert.equal(fs.readFileSync(path.join(outdated, 'VERSION'), 'utf8').trim(), '9.0.0');
    assert.ok(!fs.existsSync(path.join(outdated, 'previous-only.txt')));
    assert.deepEqual(fs.readdirSync(claudeRoot), ['demo-video'], 'no backup stays where the host loads skills');
    const backups = fs.readdirSync(path.join(backupsRoot, 'claude'));
    assert.equal(backups.length, 1, 'each host keeps only its newest backup');
    assert.ok(fs.existsSync(path.join(backupsRoot, 'claude', backups[0], 'previous-only.txt')));
    assert.deepEqual(fs.readdirSync(path.dirname(current)), ['demo-video'], 'a current copy is left alone');
    assert.deepEqual(fs.readdirSync(unversioned), [], 'a folder without VERSION is not an installed copy');
    assert.ok(!fs.existsSync(path.join(home, '.cursor')), 'hosts without a copy get none');
    const saved = JSON.parse(fs.readFileSync(path.join(home, '.demo_video', 'update-check.json'), 'utf8'));
    assert.deepEqual([saved.status, saved.current], ['up-to-date', '9.0.0']);

    requests = served.length;
    assert.deepEqual((await updateSkill(updateOptions)).updated, []);
    assert.ok(!served.slice(requests).some((url) => url.endsWith('.zip')), 'an up-to-date skill downloads no archive');

    // Backups of another skill folder go to ~/.demo_video/backups/destination-<hash of its path>.
    const install = (...args) => execFileSync(process.execPath, [path.join(stage, 'scripts', 'install-skill.mjs'), ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    const projectSkills = path.join(updateRoot, 'project', '.claude', 'skills');
    const leftover = path.join(projectSkills, 'demo-video.backup-2020-01-01T00-00-00-000Z');
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, 'SKILL.md'), '---\nname: demo-video\n---\n');
    install('--destination', projectSkills);
    assert.deepEqual(fs.readdirSync(projectSkills), ['demo-video'], 'an install moves an earlier backup out');
    assert.throws(() => install('--destination', projectSkills), /--force/, 'an install keeps a copy without --force');
    fs.writeFileSync(path.join(projectSkills, 'demo-video', 'previous-only.txt'), 'previous copy');
    install('--destination', projectSkills, '--force');
    assert.deepEqual(fs.readdirSync(projectSkills), ['demo-video'], 'a replaced copy leaves the skill folder');
    const destinations = fs.readdirSync(backupsRoot).filter((name) => name.startsWith('destination-'));
    assert.equal(destinations.length, 1, 'another skill folder gets one backup folder');
    const destinationBackups = path.join(backupsRoot, destinations[0]);
    const kept = fs.readdirSync(destinationBackups).sort();
    assert.equal(kept.length, 2, 'install-skill.mjs prunes nothing');
    assert.ok(fs.existsSync(path.join(destinationBackups, kept[0], 'SKILL.md')), 'the earlier backup moves intact');
    assert.ok(fs.existsSync(path.join(destinationBackups, kept[1], 'previous-only.txt')), 'the replaced copy is kept');
    install('--destination', claudeRoot, '--force');
    assert.equal(fs.readdirSync(path.join(backupsRoot, 'claude')).length, 2, 'a host skill folder uses the host backup folder');
  } finally {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  const cues = [{ start: 0.4, end: 1.6, text: 'Open the workspace.' },
    { start: 4, end: 5.6, text: 'Choose a contact.\nReview the result.' }];
  assert.deepEqual(parseSrt(formatSrt(cues)), cues);
  assert.deepEqual(parseSrt(''), []);
  assert.throws(() => parseSrt('1\n00:00:03,000 --> 00:00:02,000\nInvalid'));
  assert.throws(() => editTimeline(8, [[0, 9]]));
  assert.throws(() => editTimeline(8, [[0, 8]]));
  const timeline = editTimeline(8, [[7, 8], [2, 2.7], [2.5, 3]], 1.25);
  assert.ok(Math.abs(timeline.duration - 4.8) < 0.001);
  const mapped = retimeCues(cues, timeline);
  assert.equal(mapped[0].start, 0.32);
  assert.ok(Math.abs(mapped[1].start - 2.4) < 0.001);
  assert.throws(() => retimeCues(cues, editTimeline(8, [[0.6, 1]])));
  assert.ok(!formatAss([{ start: 0, end: 1, text: '{\\pos(1,1)}' }], 640, 360).includes('{\\pos'));

  const source = path.join(root, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  fs.writeFileSync(path.join(root, 'captions.srt'), formatSrt(cues));
  const spec = path.join(root, 'delivery.json');
  fs.writeFileSync(spec, JSON.stringify({ source: 'source.mp4', captions: 'captions.srt',
    outputPrefix: "viewer's edited demo", speed: 1.25, cuts: [[2, 3], [7, 8]] }));
  runScript('deliver-video.mjs', spec);
  const clean = path.join(root, "viewer's edited demo.mp4");
  const burned = path.join(root, "viewer's edited demo_subtitled.mp4");
  assert.ok(Math.abs(duration(clean) - 4.8) < 0.15);
  assert.ok(Math.abs(duration(clean) - duration(burned)) < 0.06);
  assert.equal(streamHash(clean, 'a'), streamHash(burned, 'a'));
  assert.notEqual(streamHash(clean, 'v'), streamHash(burned, 'v'));
  assert.deepEqual(parseSrt(fs.readFileSync(path.join(root, "viewer's edited demo.srt"), 'utf8')),
    parseSrt(formatSrt(mapped)));
  assert.throws(() => runScript('deliver-video.mjs', spec));

  const replacement = path.join(root, 'replacement.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '8', replacement]);
  fs.writeFileSync(spec, JSON.stringify({ source: 'source.mp4', audio: 'replacement.wav',
    outputPrefix: 'audio-only', burnCaptions: false }));
  runScript('deliver-video.mjs', spec);
  assert.equal(streamHash(source, 'v'), streamHash(path.join(root, 'audio-only.mp4'), 'v'));
  assert.notEqual(streamHash(source, 'a'), streamHash(path.join(root, 'audio-only.mp4'), 'a'));

  const silent = path.join(root, 'silent.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-i', source, '-an', '-c:v', 'copy', silent]);
  fs.writeFileSync(spec, JSON.stringify({ source: 'silent.mp4', outputPrefix: 'silent-edited', speed: 1.25 }));
  runScript('deliver-video.mjs', spec);
  assert.ok(Math.abs(duration(path.join(root, 'silent-edited.mp4')) - 6.4) < 0.15);

  const captions = path.join(root, 'captions.srt');
  runScript('compact-silence.mjs', source, captions, path.join(root, 'compact.mp4'), path.join(root, 'compact.srt'),
    '--silence-speed', '3', '--minimum-gap-ms', '500', '--encoder', 'libx264');
  assert.ok(Math.abs(duration(path.join(root, 'compact.mp4')) - 4.8) < 0.15);
  assert.equal(parseSrt(fs.readFileSync(path.join(root, 'compact.srt'), 'utf8'))[1].start, 2.4);
  assert.throws(() => runScript('compact-silence.mjs', source, captions, path.join(root, 'fractional.mp4'),
    path.join(root, 'fractional.srt'), '--silence-speed', '2.5'), /whole number/);

  const flashed = path.join(root, 'flashed.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xE8E8F0:s=320x180:r=30:d=4', '-f', 'lavfi',
    '-i', 'sine=frequency=300:sample_rate=48000:d=4', '-vf', "drawbox=w=iw:h=ih:c=black:t=fill:enable='eq(n,45)'",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', flashed]);
  assert.throws(() => runScript('verify-video.mjs', flashed), /single-frame flashes: 00:01.50/);
  assert.match(runScript('verify-video.mjs', source), /flash QA passed/);

  const runner = path.join(scripts, 'desktop-runner.py');
  execFileSync(systemPython('the desktop path check'), ['-I', '-c', [
    'import importlib.util, random, sys',
    `spec = importlib.util.spec_from_file_location("runner", ${JSON.stringify(runner)})`,
    'runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)',
    'total, points = runner.human_path((100, 100), (1000, 600), random.Random(7))',
    'again = runner.human_path((100, 100), (1000, 600), random.Random(7))',
    'off = max(abs((x - 100) * 500 - (y - 100) * 900) for x, y in points) / (900 ** 2 + 500 ** 2) ** 0.5',
    'ok = (total, points) == again and points[-1] == (1000, 600) and 0.26 <= total <= 1.1 and off > 1',
    'sys.exit(0 if ok and runner.move_duration(60) < total else 1)',
  ].join('\n')], { stdio: 'inherit' });

  await testSignedUpdates(root);

  const engine = ['kokoro', 'piper'].find((name) => process.argv.includes(`--with-${name}`)) ?? 'tiny-tts';
  const config = { engine, speed: 1 };
  const clip = path.join(root, 'speech.wav');
  const text = 'Open the workspace and choose a contact to review the result.';
  const cache = path.join(root, 'clips');
  const first = await cachedNarration(text, clip, config, cache);
  assert.equal(first.cached, false);
  const second = await cachedNarration(text, clip, config, cache);
  assert.equal(second.cached, true);
  assert.equal(first.durationMs, second.durationMs);
  const faster = await cachedNarration(text, clip, { ...config, speed: 1.4 }, cache);
  assert.equal(faster.cached, false);
  assert.ok(faster.durationMs < first.durationMs * 0.9);
  await assert.rejects(synthesize('Invalid speed', clip, { speed: 0 }));
  await assert.rejects(synthesize('Invalid engine', clip, { engine: 'unsupported' }));
  await assert.rejects(synthesize('Same fallback', clip, { engine: 'piper', fallbackEngine: 'piper' }), /fallbackEngine/);
  await assert.rejects(synthesize('Unknown fallback', clip, { fallbackEngine: 'espeak' }), /fallbackEngine/);
  if (engine === 'piper') {
    await assert.rejects(synthesize('Unavailable model', clip, { engine, piperModel: path.join(root, 'missing.onnx') }),
      /piper narration failed/);
  }
  if (engine === 'kokoro') {
    await assert.rejects(synthesize('Unknown voice', clip, { engine, kokoroVoice: 'zz_nobody' }), /kokoro narration failed/);
  }
  await disposeSynthesizer();

  const definition = path.join(root, 'offline.recording.json');
  const settings = { url: 'http://127.0.0.1:1', authRefresh: { url: 'http://127.0.0.1:1' },
    narrationConfig: config, quality: { encoder: 'libx264', trimLeadingLoading: false },
    steps: [{ action: 'wait', ms: 8000, narration: 'Open the workspace.' }] };
  fs.writeFileSync(definition, JSON.stringify(settings));
  runScript('generate-narration.mjs', definition);
  runScript('compile-video.mjs', definition, '--reuse-video', silent);
  assert.ok(fs.existsSync(path.join(root, 'demo', 'output', 'offline.mp4')));
  settings.steps[0].narration = 'Choose a contact.';
  fs.writeFileSync(definition, JSON.stringify(settings));
  assert.throws(() => runScript('compile-video.mjs', definition, '--reuse-video', silent), /stale/);
  settings.steps = [{ action: 'if', then: [{ action: 'wait', narration: 'A hidden branch.' }] }];
  fs.writeFileSync(definition, JSON.stringify(settings));
  assert.throws(() => runScript('generate-narration.mjs', definition), /branch narration/);
  settings.steps = [{ action: 'wait', ms: 500, spokenNarration: 'Speech without a caption.' }];
  fs.writeFileSync(definition, JSON.stringify(settings));
  assert.throws(() => runScript('generate-narration.mjs', definition), /spokenNarration needs/);
  console.log(`[release-test] passed with ${engine}: paired delivery, ASS, cuts, speed, stream copy, audio replacement, `
    + 'whole-number silence compaction, flash detection, desktop paths, signed update checks, skill updates, '
    + 'narration cache, engine fallback rules, offline reuse, spoken narration rules, and stale audio rejection.');
} finally {
  await disposeSynthesizer();
  if (process.argv.includes('--keep-artifacts')) console.log(`[release-test] artifacts: ${root}`);
  else fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
