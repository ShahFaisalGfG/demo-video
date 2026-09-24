import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REQUIRED_DEPS = {
  testreel: '^0.2.0',
  playwright: '^1.40.0',
  'ffmpeg-static': '^5.2.0',
  'ffprobe-static': '^3.1.0',
  'tiny-tts': '^5.0.0',
};

export function demoVideoHome() {
  return path.join(os.homedir(), '.demo_video');
}

export function browsersDir(home = demoVideoHome()) {
  return path.join(home, 'browsers');
}

export function projectCacheDir(home = demoVideoHome()) {
  const hash = crypto.createHash('sha1').update(path.resolve(process.cwd())).digest('hex').slice(0, 10);
  const directory = path.join(home, 'cache', hash);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '.project-path'), path.resolve(process.cwd()));
  return directory;
}

function dependenciesInstalled(home) {
  return Object.keys(REQUIRED_DEPS).every((dependency) =>
    fs.existsSync(path.join(home, 'node_modules', dependency, 'package.json')),
  );
}

function chromiumInstalled(browserPath) {
  return fs.existsSync(browserPath) && fs.readdirSync(browserPath).some((entry) => entry.startsWith('chromium'));
}

export function ensureIsolatedDeps() {
  const home = demoVideoHome();
  fs.mkdirSync(home, { recursive: true });
  const packagePath = path.join(home, 'package.json');
  if (!fs.existsSync(packagePath)) {
    fs.writeFileSync(packagePath, JSON.stringify({
      name: 'demo-video-isolated-deps',
      private: true,
      dependencies: REQUIRED_DEPS,
    }, null, 2));
  }
  if (!dependenciesInstalled(home)) {
    console.log(`[demo-video] installing pipeline dependencies in ${home} ...`);
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: home,
      stdio: 'inherit',
      shell: true,
    });
  } else {
    console.log('[demo-video] pipeline dependencies already installed.');
  }
  const browserPath = browsersDir(home);
  if (!chromiumInstalled(browserPath)) {
    console.log(`[demo-video] installing chromium into ${browserPath} ...`);
    execFileSync('npx', ['playwright', 'install', 'chromium'], {
      cwd: home,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
    });
  } else {
    console.log('[demo-video] chromium already installed.');
  }
  console.log('[demo-video] owned recorder adapter active; bundled testreel files remain unmodified.');
  return { home, browsers: browserPath };
}
