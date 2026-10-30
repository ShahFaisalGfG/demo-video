// Human-like cursor motion and zoom for browser recordings.
//
// testreel composites its cursor as straight, constant-speed lines, and its
// FFmpeg expression nests once per move, which fails after about 48 moves and
// silently drops the cursor, window chrome, and background. This module draws
// the cursor inside the page instead, so the recorded video carries it frame by
// frame without a move limit, and moves it the way a hand does: a curved arc,
// minimum-jerk speed (slow start, fast middle, gentle landing), Fitts-law
// timing (longer reaches take longer), and a small overshoot and settle on long
// reaches. A seeded generator gives the same path for the same layout.
//
// Zoom uses Chromium's own pinch zoom, which magnifies the visible area without
// changing layout, so fixed headers and dialogs move with the content like a
// camera zoom. Under pinch zoom, Playwright boxes and mouse events share one
// coordinate space (page coordinates minus the visual viewport offset), while
// the drawn cursor lives in page coordinates; this module converts between them.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const STYLES = ['default', 'pointer', 'text', 'touch'];
const HOTSPOTS = { default: { x: 0, y: 0 }, pointer: { x: 0.38, y: 0.2 }, text: { x: 0.5, y: 0.5 }, touch: { x: 0.5, y: 0.5 } };
const NAVIGATION_ERROR = /Execution context was destroyed|navigation|has been closed|detached|Target closed/i;
// Chromium's synthetic pinch moves two fingers about this far per unit of scale change; speed = travel / duration.
const PINCH_TRAVEL_PX = 205;

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
 * Plan a reach from `from` to `to` in page coordinates: returns its duration and positions at equal time steps.
 * `size` is the target's smaller side and `scale` the zoom level, so timing follows the on-screen distance.
 */
export function humanPath(from, to, random, size = 40, scale = 1) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return { durationMs: 0, points: [to] };
  const durationMs = moveDuration(distance * scale, size * scale);
  const unit = { x: dx / distance, y: dy / distance };
  const bend = (random() * 2 - 1) * Math.min(0.18 * distance, 90 / scale);
  const control = { x: from.x + dx * 0.45 - unit.y * bend, y: from.y + dy * 0.45 + unit.x * bend };
  const overshoot = distance * scale > 280 ? Math.min(distance * 0.025, 10 / scale) * (0.6 + random() * 0.4) : 0;
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

/**
 * Runs in every frame. Each frame gets `__demoVideoCursorStyle(element)`, the cursor an element shows; the top
 * frame also draws the cursor in a closed shadow root and animates it along planned paths in page coordinates.
 */
function cursorOverlay(settings) {
  const styleOf = (element) => {
    if (settings.style === 'touch') return 'touch';
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
  if (!window.__demoVideoCursorStyle) Object.defineProperty(window, '__demoVideoCursorStyle', { value: styleOf });
  if (window.top !== window || window.__demoVideoCursor) return;

  const state = { x: -200, y: -200, style: 'default', visible: true, idle: false };
  let host;
  let shadow;
  let sprite;
  let shown;
  const canvases = {};
  let idleTimer = 0;
  let moving = false;

  // The cursor for a page point, looking inside same-origin frames; null over a cross-origin frame it cannot read.
  const styleAt = (x, y) => {
    let view = document;
    let element = view.elementFromPoint(x, y);
    while (element && /^i?frame$/i.test(element.tagName)) {
      let inner;
      try {
        inner = element.contentDocument;
      } catch {
        inner = null;
      }
      if (!inner) return null;
      const box = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      x -= box.left + element.clientLeft + parseFloat(css.paddingLeft);
      y -= box.top + element.clientTop + parseFloat(css.paddingTop);
      view = inner;
      element = view.elementFromPoint(x, y);
    }
    return styleOf(element);
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

  // Page point to the host's own coordinates, in case the page itself transforms <html>.
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
      }, settings.idleHideMs);
    }
  };

  // `arrival` is the target's own cursor style, read in its frame, which also covers cross-origin frames.
  const move = (points, durationMs, arrival) => new Promise((resolve) => {
    clearTimeout(idleTimer);
    state.idle = false;
    moving = true;
    const started = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      Object.assign(state, points[points.length - 1]);
      state.style = arrival ?? styleAt(state.x, state.y) ?? state.style;
      moving = false;
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
      state.style = styleAt(state.x, state.y) ?? state.style;
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
  };

  // Put the cursor back after a page load, where the previous document left it.
  const place = (point, style, visible, idle) => {
    Object.assign(state, point, { style, visible, idle });
    draw();
    if (!idle) rest();
  };

  // At rest the shape follows the page as a system cursor does: a dialog closing or a scroll can change what is under it.
  setInterval(() => {
    if (moving || !state.visible || state.idle || !host?.isConnected) return;
    const style = styleAt(state.x, state.y);
    if (style && style !== state.style) {
      state.style = style;
      draw();
    }
  }, 250);

  Object.defineProperty(window, '__demoVideoCursor', { value: { move, ripple, setVisible, place } });
  if (!mount()) document.addEventListener('readystatechange', draw, { once: true });
  else draw();
}

/** Run a page function, ignoring a navigation that replaces the page mid-call (the cursor and zoom are cosmetic). */
async function evaluateQuietly(target, run, argument) {
  try {
    return await target.evaluate(run, argument);
  } catch (error) {
    if (NAVIGATION_ERROR.test(error.message)) return undefined;
    throw error;
  }
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

/** A cursor drawn in the recorded page, moved along human paths before each pointer action, with pinch zoom. */
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
      idleHideMs: HumanCursor.idleHideMs(options),
      fadeMs: options.fadeMs ?? 400,
    });
  }

  /** Idle time before the cursor fades, or 0 when it stays visible. */
  static idleHideMs(options = {}) {
    return options.idleHide === false ? 0 : options.idleHideMs ?? 3000;
  }

  /** `seedSource` is any stable value (such as the definition's steps), so a layout always moves the same way. */
  constructor(page, viewport, seedSource, options = {}) {
    this.page = page;
    this.viewport = viewport;
    this.position = { x: viewport.width * 0.62, y: viewport.height * 0.72 };
    this.style = 'default';
    this.visible = true;
    this.idleHideMs = HumanCursor.idleHideMs(options);
    this.movedAt = 0;
    this.scale = 1;
    this.zoomOutPending = false;
    const digest = crypto.createHash('sha256').update(JSON.stringify(seedSource ?? null)).digest();
    this.random = seededRandom(digest.readUInt32LE(0));
    this.wrapClicks();
    page.on('domcontentloaded', () => this.restore().catch((error) => {
      console.warn(`[human-cursor] could not restore the cursor after a page load: ${error.message}`);
    }));
  }

  /** Call one of the overlay's page functions (move, ripple, setVisible, place). */
  async call(method, ...args) {
    return evaluateQuietly(this.page, ([name, values]) => window.__demoVideoCursor?.[name](...values), [method, args]);
  }

  /** Visual viewport offset and scale; Playwright boxes and mouse events sit at page coordinates minus the offset. */
  async view() {
    const view = await evaluateQuietly(this.page, () => ({ left: visualViewport.offsetLeft, top: visualViewport.offsetTop,
      scale: visualViewport.scale, width: visualViewport.width, height: visualViewport.height }));
    return view ?? { left: 0, top: 0, scale: 1, width: this.viewport.width, height: this.viewport.height };
  }

  /** Put the cursor back where it was after a new document loads, any origin. */
  async restore() {
    const idle = this.idleHideMs > 0 && this.movedAt > 0 && Date.now() - this.movedAt > this.idleHideMs;
    await this.call('place', this.position, this.style, this.visible, idle);
    this.scale = (await this.view()).scale;
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
    const view = await this.view();
    let point = target;
    let size = 40;
    let arrival;
    if (typeof target.boundingBox === 'function') {
      const box = await target.boundingBox();
      if (!box) return;
      size = Math.min(box.width, box.height);
      const spread = Math.min(size * 0.1, 4);
      point = {
        x: box.x + box.width / 2 + (this.random() * 2 - 1) * spread,
        y: box.y + box.height / 2 + (this.random() * 2 - 1) * spread,
      };
      arrival = await evaluateQuietly(target, (element) => window.__demoVideoCursorStyle?.(element));
    }
    const pagePoint = { x: point.x + view.left, y: point.y + view.top };
    const { durationMs, points } = humanPath(this.position, pagePoint, this.random, size, view.scale);
    await this.call('move', points, durationMs, arrival ?? null);
    this.position = pagePoint;
    this.style = arrival ?? this.style;
    this.movedAt = Date.now();
    await this.page.mouse.move(point.x, point.y);
  }

  /**
   * Pinch-zoom toward a viewport point (scale 1 returns to the full view), taking `durationMs` in total.
   * The point stays where it is on screen, as under a two-finger pinch; a missing point skips a zoom-in.
   */
  async zoom(point, scale = 2, durationMs = 600) {
    const view = await this.view();
    const factor = scale / view.scale;
    if ((scale !== 1 && !point) || Math.abs(factor - 1) < 0.01) return;
    const anchor = scale === 1 ? { x: view.width / 2, y: view.height / 2 }
      : { x: Math.min(view.width - 1, Math.max(1, point.x)), y: Math.min(view.height - 1, Math.max(1, point.y)) };
    const travel = PINCH_TRAVEL_PX * (Math.max(factor, 1 / factor) - 1);
    const started = Date.now();
    try {
      this.cdp ??= await this.page.context().newCDPSession(this.page);
      await this.cdp.send('Input.synthesizePinchGesture', { x: anchor.x, y: anchor.y, scaleFactor: factor,
        relativeSpeed: Math.max(1, Math.round(travel / (durationMs / 1000))), gestureSourceType: 'mouse' });
    } catch (error) {
      if (!NAVIGATION_ERROR.test(error.message)) throw error;
    }
    this.scale = (await this.view()).scale;
    const remaining = durationMs + 50 - (Date.now() - started);
    if (remaining > 0) await this.page.waitForTimeout(remaining);
  }

  /** Draw a click ripple at the cursor. */
  async ripple() {
    await this.call('ripple');
  }

  /** Fade the cursor out until show() (hideCursor step). */
  async hide() {
    this.visible = false;
    await this.call('setVisible', false);
  }

  /** Fade the cursor back in (showCursor step). */
  async show() {
    this.visible = true;
    await this.call('setVisible', true);
  }
}
