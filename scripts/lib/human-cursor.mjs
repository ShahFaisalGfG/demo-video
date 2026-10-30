// Human-like cursor motion for browser recordings.
//
// testreel composites its cursor as straight, constant-speed lines, and its
// FFmpeg expression nests once per move, which fails after about 48 moves and
// silently drops the cursor, window chrome, and background. This module draws
// the cursor inside the page instead, so the recorded video carries it frame by
// frame without a move limit, and moves it the way a hand does: a curved arc,
// minimum-jerk speed (slow start, fast middle, gentle landing), Fitts-law
// timing (longer reaches take longer), and a small overshoot and settle on long
// reaches. A seeded generator gives the same path for the same layout on every render.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const STYLES = ['default', 'pointer', 'text', 'touch'];
const HOTSPOTS = { default: { x: 0, y: 0 }, pointer: { x: 0.38, y: 0.2 }, text: { x: 0.5, y: 0.5 }, touch: { x: 0.5, y: 0.5 } };
const NAVIGATION_ERROR = /Execution context was destroyed|navigation|has been closed/i;

/** Browser actions that move the cursor to their selector before acting. */
export const POINTER_ACTIONS = ['click', 'clickResponse', 'type', 'fill', 'clear', 'select', 'hover', 'check', 'uncheck'];

/** Average extra time a human reach takes over testreel's linear move; narration placement adds it per pointer action. */
export const HUMAN_REACH_EXTRA_MS = 300;

/** Cursor settings of a browser definition: whether a cursor shows, whether it moves like a hand, and its options. */
export function cursorSettings(definition) {
  const options = definition.cursor;
  if (options === false || options?.enabled === false) return { enabled: false, human: false, options: {} };
  const settings = options && typeof options === 'object' ? options : {};
  if (settings.motion !== undefined && !['human', 'linear'].includes(settings.motion)) {
    throw new Error('cursor.motion must be "human" or "linear".');
  }
  return { enabled: true, human: (settings.motion ?? 'human') === 'human', options: settings };
}

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fitts-law movement time in milliseconds for a reach of `distance` pixels to a target `size` pixels wide. */
export function moveDuration(distance, size = 40) {
  return Math.min(1100, Math.max(260, 180 + 120 * Math.log2(1 + distance / Math.max(12, size))));
}

function minimumJerk(t) {
  return t * t * t * (10 - 15 * t + 6 * t * t);
}

/**
 * Plan a reach from `from` to `to`: returns its duration and positions sampled at equal time steps.
 * `size` is the target's smaller side, which shortens reaches to large targets.
 */
export function humanPath(from, to, random, size = 40) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return { durationMs: 0, points: [to] };
  const durationMs = moveDuration(distance, size);
  const unit = { x: dx / distance, y: dy / distance };
  const bend = (random() * 2 - 1) * Math.min(0.18 * distance, 90);
  const control = { x: from.x + dx * 0.45 - unit.y * bend, y: from.y + dy * 0.45 + unit.x * bend };
  const overshoot = distance > 280 ? Math.min(distance * 0.025, 10) * (0.6 + random() * 0.4) : 0;
  const landing = { x: to.x + unit.x * overshoot, y: to.y + unit.y * overshoot };
  const reach = overshoot ? 0.86 : 1;
  const samples = Math.max(12, Math.round(durationMs / 16));
  const points = [];
  for (let index = 0; index <= samples; index++) {
    const time = index / samples;
    if (time <= reach) {
      const s = minimumJerk(time / reach);
      points.push({
        x: (1 - s) ** 2 * from.x + 2 * (1 - s) * s * control.x + s * s * landing.x,
        y: (1 - s) ** 2 * from.y + 2 * (1 - s) * s * control.y + s * s * landing.y,
      });
    } else {
      const s = minimumJerk((time - reach) / (1 - reach));
      points.push({ x: landing.x + (to.x - landing.x) * s, y: landing.y + (to.y - landing.y) * s });
    }
  }
  return { durationMs, points };
}

/** Runs inside every page: draws the cursor in a closed shadow root and animates it along planned paths. */
function cursorOverlay(settings) {
  if (window.top !== window || window.__demoVideoCursor) return;
  const KEY = '__demoVideoCursor';
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY));
    } catch {
      return null;
    }
  })();
  const state = { x: -200, y: -200, style: 'default', visible: true, idle: false, ...saved };
  let host;
  let shadow;
  let sprite;
  let shown;
  const canvases = {};
  let idleTimer = 0;

  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable on opaque origins; the cursor then starts from its default spot.
    }
  };

  const styleAt = (x, y) => {
    if (settings.style === 'touch') return 'touch';
    const element = document.elementFromPoint(x, y);
    if (!element) return 'default';
    const css = getComputedStyle(element).cursor;
    if (css === 'pointer' || css === 'text') return css;
    if (css && css !== 'auto' && css !== 'default') return 'default';
    const tag = element.tagName.toLowerCase();
    if (['a', 'button', 'select', 'summary'].includes(tag) || element.closest('a,button,[role="button"],[role="link"]')) {
      return 'pointer';
    }
    if (tag === 'textarea' || element.isContentEditable) return 'text';
    if (tag === 'input') {
      const type = (element.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''].includes(type) ? 'text' : 'pointer';
    }
    return 'default';
  };

  const mount = () => {
    const root = document.documentElement;
    if (!root) return false;
    if (!host) {
      host = document.createElement('demo-video-cursor');
      host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;overflow:visible;'
        + 'z-index:2147483647;pointer-events:none;';
      shadow = host.attachShadow({ mode: 'closed' });
      sprite = document.createElement('div');
      sprite.style.cssText = `position:absolute;left:0;top:0;width:${settings.size}px;height:${settings.size}px;`
        + `pointer-events:none;transition:opacity ${settings.fadeMs}ms ease;`;
      // Canvas pixels instead of image URLs: a page's img-src policy cannot block them.
      for (const [style, pixels] of Object.entries(settings.images)) {
        const canvas = document.createElement('canvas');
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        canvas.style.cssText = `display:none;width:${settings.size}px;height:${settings.size}px;`;
        const bytes = Uint8ClampedArray.from(atob(pixels.data), (char) => char.charCodeAt(0));
        canvas.getContext('2d').putImageData(new ImageData(bytes, pixels.width, pixels.height), 0, 0);
        sprite.append(canvas);
        canvases[style] = canvas;
      }
      shadow.append(sprite);
      new MutationObserver(() => {
        if (!host.isConnected && document.documentElement) document.documentElement.append(host);
      }).observe(root, { childList: true });
    }
    if (!host.isConnected) root.append(host);
    return true;
  };

  // Viewport point to the host's own coordinates, which a CSS zoom on <html> transforms.
  const toLocal = (x, y) => {
    const origin = host.getBoundingClientRect();
    const transform = getComputedStyle(document.documentElement).transform;
    const matrix = transform && transform !== 'none' ? new DOMMatrix(transform) : new DOMMatrix();
    return new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, 0, 0]).inverse()
      .transformPoint(new DOMPoint(x - origin.left, y - origin.top));
  };

  const draw = () => {
    if (!mount()) return;
    const canvas = canvases[state.style] ?? canvases.default;
    if (shown !== canvas) {
      if (shown) shown.style.display = 'none';
      canvas.style.display = 'block';
      shown = canvas;
    }
    const hotspot = settings.hotspots[state.style] ?? settings.hotspots.default;
    const point = toLocal(state.x, state.y);
    sprite.style.transform = `translate(${point.x - hotspot.x * settings.size}px, ${point.y - hotspot.y * settings.size}px)`;
    sprite.style.opacity = state.visible && !state.idle ? '1' : '0';
  };

  const rest = () => {
    clearTimeout(idleTimer);
    if (settings.idleHideMs > 0) {
      idleTimer = setTimeout(() => {
        state.idle = true;
        draw();
        save();
      }, settings.idleHideMs);
    }
    save();
  };

  const move = (points, durationMs) => new Promise((resolve) => {
    clearTimeout(idleTimer);
    state.idle = false;
    const started = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      Object.assign(state, points[points.length - 1]);
      state.style = styleAt(state.x, state.y);
      draw();
      rest();
      resolve();
    };
    // A timer drives the ticks: headless Chromium can withhold animation frames while the video
    // screencast starts, and a style change made from a timer still produces a captured frame.
    const frame = () => {
      if (done) return;
      const progress = durationMs > 0 ? Math.min(1, (performance.now() - started) / durationMs) : 1;
      if (progress >= 1 || points.length < 2) return finish();
      const exact = progress * (points.length - 1);
      const index = Math.floor(exact);
      const fraction = exact - index;
      state.x = points[index].x + (points[index + 1].x - points[index].x) * fraction;
      state.y = points[index].y + (points[index + 1].y - points[index].y) * fraction;
      state.style = styleAt(state.x, state.y);
      draw();
      setTimeout(frame, 16);
    };
    frame();
  });

  const ripple = () => {
    if (!mount()) return;
    const point = toLocal(state.x, state.y);
    const size = settings.rippleSize;
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;left:${point.x - size / 2}px;top:${point.y - size / 2}px;width:${size}px;`
      + `height:${size}px;border-radius:50%;background:${settings.rippleColor};pointer-events:none;`;
    shadow.prepend(ring);
    ring.animate([{ transform: 'scale(0.2)', opacity: 1 }, { transform: 'scale(1)', opacity: 0 }],
      { duration: 450, easing: 'ease-out' }).finished.then(() => ring.remove(), () => ring.remove());
  };

  const setVisible = (visible) => {
    state.visible = visible;
    draw();
    save();
  };

  Object.defineProperty(window, '__demoVideoCursor', { value: { move, ripple, setVisible } });
  if (!mount()) document.addEventListener('readystatechange', draw, { once: true });
  else draw();
}

/** Run a page function, ignoring a navigation that replaces the page mid-call (the cursor and zoom are cosmetic). */
async function evaluateQuietly(page, run, argument) {
  try {
    return await page.evaluate(run, argument);
  } catch (error) {
    if (NAVIGATION_ERROR.test(error.message)) return undefined;
    throw error;
  }
}

/**
 * Zoom the page toward a viewport point with an eased CSS transform on <html>, which the browser renders sharply;
 * scale 1 returns to the full view and restores the page's own inline styles. A missing point skips a zoom-in.
 */
export async function zoomPage(page, point, scale = 2, durationMs = 600) {
  if (scale !== 1 && !point) return;
  await evaluateQuietly(page, ({ target, level, duration }) => new Promise((resolve) => {
    const root = document.documentElement;
    const css = getComputedStyle(root).transform;
    const current = css && css !== 'none' ? new DOMMatrix(css) : new DOMMatrix();
    const origin = { x: -scrollX, y: -scrollY };
    const offset = (axis, size) => {
      const key = axis === 'x' ? 'e' : 'f';
      const scaleKey = axis === 'x' ? 'a' : 'd';
      const unzoomed = origin[axis] + (target[axis] - origin[axis] - current[key]) / current[scaleKey];
      const wanted = size / 2 - origin[axis] - level * (unzoomed - origin[axis]);
      return Math.min((1 - level) * origin[axis] * -1, Math.max((1 - level) * (size - origin[axis]), wanted));
    };
    if (level !== 1 && !window.__demoVideoZoom) {
      Object.defineProperty(window, '__demoVideoZoom', { configurable: true, value: {
        transform: root.style.transform, transformOrigin: root.style.transformOrigin, transition: root.style.transition,
      } });
    }
    const saved = window.__demoVideoZoom;
    root.style.transformOrigin = '0 0';
    root.style.transition = `transform ${duration}ms ease-in-out`;
    root.style.transform = level === 1 ? 'matrix(1, 0, 0, 1, 0, 0)'
      : `matrix(${level}, 0, 0, ${level}, ${offset('x', innerWidth)}, ${offset('y', innerHeight)})`;
    setTimeout(() => {
      if (level === 1) {
        Object.assign(root.style, saved ?? { transform: '', transformOrigin: '', transition: '' });
        delete window.__demoVideoZoom;
      }
      resolve();
    }, duration + 50);
  }), { target: point, level: scale, duration: durationMs });
}

/** Center of a locator's box in viewport coordinates, or null when it has no box. */
export async function boxCenter(target) {
  const box = await target.boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

/** Decode an 8-bit RGBA, non-interlaced PNG (testreel's cursor images) into width, height, and pixel bytes. */
export function decodePng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (buffer[24] !== 8 || buffer[25] !== 6 || buffer[28] !== 0) throw new Error('Cursor PNG must be 8-bit RGBA, not interlaced.');
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString('latin1', offset + 4, offset + 8) === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    for (let column = 0; column < stride; column++) {
      const value = raw[row * (stride + 1) + 1 + column];
      const left = column >= 4 ? pixels[row * stride + column - 4] : 0;
      const up = row ? pixels[(row - 1) * stride + column] : 0;
      const corner = row && column >= 4 ? pixels[(row - 1) * stride + column - 4] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
      if (predictor === undefined) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[row * stride + column] = (value + predictor) & 0xff;
    }
  }
  return { width, height, data: pixels.toString('base64') };
}

function paeth(left, up, corner) {
  const estimate = left + up - corner;
  const [toLeft, toUp, toCorner] = [left, up, corner].map((value) => Math.abs(estimate - value));
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

function cursorImages() {
  const dist = path.dirname(createRequire(import.meta.url).resolve('testreel'));
  return Object.fromEntries(STYLES.map((style) => [style, decodePng(fs.readFileSync(path.join(dist, `${style}.png`)))]));
}

/** A cursor drawn in the recorded page, moved along human paths before each pointer action. */
export class HumanCursor {
  /** Register the overlay on a browser context before its first page opens. */
  static async install(context, options = {}) {
    await context.addInitScript(cursorOverlay, {
      images: cursorImages(),
      hotspots: HOTSPOTS,
      size: options.size ?? 48,
      style: options.style ?? 'default',
      rippleSize: options.rippleSize ?? 100,
      rippleColor: options.rippleColor ?? 'rgba(0, 0, 0, 0.4)',
      idleHideMs: options.idleHide === false ? 0 : options.idleHideMs ?? 3000,
      fadeMs: options.fadeMs ?? 400,
    });
  }

  /** `seedSource` is any stable value (such as the definition's steps), so a definition always moves the same way. */
  constructor(page, viewport, seedSource) {
    this.page = page;
    this.position = { x: viewport.width * 0.62, y: viewport.height * 0.72 };
    const digest = crypto.createHash('sha256').update(JSON.stringify(seedSource ?? null)).digest();
    this.random = seededRandom(digest.readUInt32LE(0));
    this.zoomOutPending = false;
    this.wrapClicks();
  }

  /** Call one of the overlay's page functions (move, ripple, setVisible). */
  async call(method, ...args) {
    return evaluateQuietly(this.page, ([name, values]) => window.__demoVideoCursor?.[name](...values), [method, args]);
  }

  /** Show a click ripple at the moment of every mouse click the recorder sends to the page. */
  wrapClicks() {
    const mouse = this.page.mouse;
    const click = mouse.click.bind(mouse);
    mouse.click = async (...args) => {
      await this.ripple();
      return click(...args);
    };
  }

  /** Glide to a locator's center (with a small human offset) or to an { x, y } viewport point. */
  async moveTo(target) {
    let point = target;
    let size = 40;
    if (typeof target.boundingBox === 'function') {
      const box = await target.boundingBox();
      if (!box) return;
      size = Math.min(box.width, box.height);
      const spread = Math.min(size * 0.1, 4);
      point = {
        x: box.x + box.width / 2 + (this.random() * 2 - 1) * spread,
        y: box.y + box.height / 2 + (this.random() * 2 - 1) * spread,
      };
    }
    const { durationMs, points } = humanPath(this.position, point, this.random, size);
    await this.call('move', points, durationMs);
    this.position = point;
    await this.page.mouse.move(point.x, point.y);
  }

  /** Draw a click ripple at the cursor. */
  async ripple() {
    await this.call('ripple');
  }

  /** Fade the cursor out until show() (hideCursor step). */
  async hide() {
    await this.call('setVisible', false);
  }

  /** Fade the cursor back in (showCursor step). */
  async show() {
    await this.call('setVisible', true);
  }
}
