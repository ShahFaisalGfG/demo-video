/** Parse ordered SRT cues with strict timestamps and non-overlapping intervals. */
export function parseSrt(contents) {
  const source = contents.replace(/^\uFEFF/, '').trim();
  if (!source) return [];
  let previous = 0;
  return source.split(/\r?\n\s*\r?\n/).map((block, index) => {
    const lines = block.split(/\r?\n/);
    const timing = lines.findIndex((line) => line.includes('-->'));
    const match = timing < 0 ? null : lines[timing].match(
      /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/);
    if (!match) throw new Error(`Invalid SRT timing in cue ${index + 1}.`);
    const seconds = (offset) => Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60
      + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    const start = seconds(1);
    const end = seconds(5);
    const text = lines.slice(timing + 1).join('\n').trim();
    if (!text || end <= start || start < previous) throw new Error(`Invalid or overlapping SRT cue ${index + 1}.`);
    previous = end;
    return { start, end, text };
  });
}

/** Format timestamps in SRT milliseconds or ASS centiseconds. */
function timestamp(seconds, ass = false) {
  const units = ass ? 100 : 1000;
  const value = Math.max(0, Math.round(seconds * units));
  const hours = Math.floor(value / (3600 * units));
  const minutes = Math.floor(value / (60 * units)) % 60;
  const whole = Math.floor(value / units) % 60;
  return `${String(hours).padStart(ass ? 1 : 2, '0')}:${String(minutes).padStart(2, '0')}:`
    + `${String(whole).padStart(2, '0')}${ass ? '.' : ','}${String(value % units).padStart(ass ? 2 : 3, '0')}`;
}

/** Serialize captions without changing their wording or cue boundaries. */
export function formatSrt(cues) {
  return cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`)
    .join('\n\n') + '\n';
}

/** Produce readable white bold captions on opaque black boxes. */
export function formatAss(cues, width, height, options = {}) {
  const font = options.font ?? 'Arial';
  const size = options.fontSize ?? Math.round(height * 0.035);
  const alignment = options.position === 'top' ? 8 : 2;
  const margin = options.margin ?? Math.round(height * 0.06);
  if (/[\r\n,]/.test(font) || !Number.isFinite(size) || size <= 0
    || !Number.isFinite(margin) || margin < 0) throw new Error('Invalid caption font, size, or margin.');
  if (options.position && !['top', 'bottom'].includes(options.position)) throw new Error('Caption position must be top or bottom.');
  const escape = (text) => text.replace(/<[^>]+>/g, '').replaceAll('\\', '＼')
    .replaceAll('{', '｛').replaceAll('}', '｝').replace(/\r?\n/g, '\\N');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n`
    + '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    + `Style: Default,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,${Math.max(2, Math.round(height / 360))},0,${alignment},${Math.round(width * 0.06)},${Math.round(width * 0.06)},${margin},1\n\n`
    + '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    + cues.map((cue) => `Dialogue: 0,${timestamp(cue.start, true)},${timestamp(cue.end, true)},Default,,0,0,0,,${escape(cue.text)}`).join('\n') + '\n';
}
