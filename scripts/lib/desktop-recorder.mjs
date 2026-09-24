import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { ensureDesktopEnv } from './desktop-venv.mjs';

function captureArgs(capture) {
  const fps = String(capture.fps ?? 30);
  if (process.platform === 'win32') {
    const region = capture.videoSize
      ? ['-offset_x', String(capture.offsetX ?? 0), '-offset_y', String(capture.offsetY ?? 0),
        '-video_size', capture.videoSize]
      : [];
    return ['-f', 'gdigrab', '-framerate', fps, '-draw_mouse', '1', ...region, '-i', capture.input ?? 'desktop'];
  }
  if (process.platform === 'darwin') {
    if (!capture.input) throw new Error('macOS desktop capture requires capture.input, such as "1:none".');
    return ['-f', 'avfoundation', '-framerate', fps, '-capture_cursor', '1', '-i', String(capture.input)];
  }
  if (process.platform === 'linux') {
    if (!capture.videoSize) throw new Error('Linux X11 capture requires capture.videoSize, such as "1920x1080".');
    const display = capture.input ?? process.env.DISPLAY;
    if (!display) throw new Error('Linux X11 capture requires capture.input or the DISPLAY environment variable.');
    return ['-f', 'x11grab', '-framerate', fps, '-video_size', capture.videoSize,
      '-draw_mouse', '1', '-i', `${display}+${capture.offsetX ?? 0},${capture.offsetY ?? 0}`];
  }
  throw new Error(`Native desktop capture is unsupported on ${process.platform}.`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}.`)));
  });
}

export async function recordDesktop(definitionPath, outputPath) {
  const definition = JSON.parse(fs.readFileSync(definitionPath, 'utf8'));
  const rootCapture = definition.capture ?? {};
  const capture = { ...rootCapture, ...(rootCapture.platforms?.[process.platform] ?? {}) };
  if (capture.type !== 'desktop') throw new Error('Desktop definitions require capture.type="desktop".');
  const python = ensureDesktopEnv();
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop-runner.py');
  execFileSync(python, [runner, definitionPath, '--validate'], { stdio: 'inherit' });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = [
    '-hide_banner', '-loglevel', 'warning', ...captureArgs(capture),
    '-c:v', 'libx264', '-preset', capture.preset ?? 'ultrafast', '-crf', String(capture.crf ?? 18),
    '-pix_fmt', 'yuv420p', '-an', '-y', outputPath,
  ];
  const recorder = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let errorOutput = '';
  recorder.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  await new Promise((resolve) => setTimeout(resolve, capture.startDelayMs ?? 900));
  if (recorder.exitCode !== null) throw new Error(`Desktop capture failed to start: ${errorOutput}`);
  let runnerError;
  try {
    execFileSync(python, [runner, definitionPath], { stdio: 'inherit' });
    await new Promise((resolve) => setTimeout(resolve, capture.endDelayMs ?? 700));
  } catch (error) {
    runnerError = error;
  } finally {
    recorder.stdin.write('q\n');
    recorder.stdin.end();
    try {
      await waitForExit(recorder);
    } catch (captureError) {
      throw new Error(`${captureError.message} ${errorOutput}`.trim());
    }
  }
  if (runnerError) throw runnerError;
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    throw new Error('Desktop recorder produced no usable video.');
  }
  return { video: outputPath };
}
