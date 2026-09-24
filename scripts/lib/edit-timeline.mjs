/** Resolve source-time removals into ordered retained segments. */
export function editTimeline(duration, cuts = [], speed = 1) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error('Duration must be positive and delivery speed must be between 0.5 and 2.');
  }
  if (!Array.isArray(cuts)) throw new Error('cuts must be an array of [startSeconds, endSeconds].');
  const ordered = cuts.map((cut) => {
    if (!Array.isArray(cut) || cut.length !== 2 || !cut.every(Number.isFinite)
      || cut[0] < 0 || cut[1] <= cut[0] || cut[1] > duration + 0.001) {
      throw new Error('Each cut must be a valid interval within the source duration.');
    }
    return [...cut];
  }).sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const cut of ordered) {
    const last = merged.at(-1);
    if (last && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1]);
    else merged.push(cut);
  }
  const segments = [];
  let cursor = 0;
  let outputStart = 0;
  for (const [start, end] of [...merged, [duration, duration]]) {
    if (start > cursor) {
      segments.push({ start: cursor, end: start, outputStart, speed });
      outputStart += (start - cursor) / speed;
    }
    cursor = end;
  }
  if (outputStart < 0.1) throw new Error('Cuts remove the entire usable video.');
  return { segments, cuts: merged, duration: outputStart, speed };
}

/** Apply the same time map to captions, protecting spoken cues by default. */
export function retimeCues(cues, timeline, allowCutSpeech = false) {
  if (!allowCutSpeech && cues.some((cue) => timeline.cuts.some(([start, end]) => cue.start < end && cue.end > start))) {
    throw new Error('A cut intersects a caption. Move it into a silent gap or explicitly set allowCutSpeech: true.');
  }
  const result = [];
  for (const cue of cues) {
    for (const segment of timeline.segments) {
      const start = Math.max(cue.start, segment.start);
      const end = Math.min(cue.end, segment.end);
      if (end - start < 0.01) continue;
      result.push({ text: cue.text,
        start: segment.outputStart + (start - segment.start) / segment.speed,
        end: segment.outputStart + (end - segment.start) / segment.speed });
    }
  }
  return result;
}
