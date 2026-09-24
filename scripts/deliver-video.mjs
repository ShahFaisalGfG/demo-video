import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { parseSrt, formatSrt, formatAss } from './lib/captions.mjs';
import { editTimeline, retimeCues } from './lib/edit-timeline.mjs';

/** Read the source streams without relying on a filename extension. */
function probeMedia(file) {
  return JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format',
    '-of', 'json', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** Build delivery variants from one clean master and one caption timeline. */
function deliverVideo(specPath) {
  const config = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const base = path.dirname(path.resolve(specPath));
  const resolve = (value) => path.resolve(base, value);
  if (!config.source || !config.outputPrefix) throw new Error('source and outputPrefix are required.');
  const source = resolve(config.source);
  const prefix = resolve(config.outputPrefix);
  const audio = config.audio ? resolve(config.audio) : null;
  const subtitle = config.captions ? resolve(config.captions) : null;
  const sourceInfo = probeMedia(source);
  const video = sourceInfo.streams.find((stream) => stream.codec_type === 'video');
  const duration = Number(video?.duration ?? sourceInfo.format.duration);
  if (!video || video.codec_name !== 'h264') throw new Error('Use a clean H.264 master for delivery.');
  const audioInfo = audio ? probeMedia(audio) : sourceInfo;
  const audioStream = audioInfo.streams.find((stream) => stream.codec_type === 'audio');
  const hasAudio = Boolean(audioStream);
  const encodeAudio = Boolean(audio) || (hasAudio && audioStream.codec_name !== 'aac');
  if (audio && (!hasAudio || Math.abs(Number(audioInfo.format.duration) - duration) > 0.25)) {
    throw new Error('Replacement audio must match the source timeline within 0.25 seconds.');
  }
  if (audio && !subtitle && config.burnCaptions !== false) {
    throw new Error('Supply captions for the replacement narration or set burnCaptions: false.');
  }
  const cues = subtitle ? parseSrt(fs.readFileSync(subtitle, 'utf8')) : [];
  if (subtitle && !cues.length) throw new Error('Caption file contains no cues.');
  if (cues.some((cue) => cue.end > duration + 0.1)) throw new Error('Captions extend beyond the source video.');
  const timeline = editTimeline(duration, config.cuts ?? [], config.speed ?? 1);
  const finalCues = retimeCues(cues, timeline, config.allowCutSpeech === true);
  const burn = config.burnCaptions !== false && finalCues.length > 0;
  const outputs = { clean: `${prefix}.mp4`, report: `${prefix}.delivery.json` };
  if (subtitle) Object.assign(outputs, { srt: `${prefix}.srt`, ass: `${prefix}.ass` });
  if (burn) outputs.captioned = `${prefix}_subtitled.mp4`;
  const inputs = [source, audio, subtitle, path.resolve(specPath)].filter(Boolean).map((file) => file.toLowerCase());
  for (const file of Object.values(outputs)) {
    if (inputs.includes(file.toLowerCase())) throw new Error('Output paths must not overwrite inputs.');
    if (fs.existsSync(file)) throw new Error(`Output exists: ${file}. Use a new outputPrefix for this revision.`);
  }
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-delivery-'));
  const staged = Object.fromEntries(Object.entries(outputs).map(([key, file]) => [key, path.join(stage, path.basename(file))]));
  const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    cwd: stage, stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    const changed = timeline.cuts.length > 0 || timeline.speed !== 1;
    const inputArgs = ['-i', source, ...(audio ? ['-i', audio] : [])];
    const audioIndex = audio ? 1 : 0;
    if (!changed) {
      run([...inputArgs, '-map', '0:v:0', ...(hasAudio ? ['-map', `${audioIndex}:a:0`] : []),
        '-c:v', 'copy', ...(hasAudio ? ['-c:a', encodeAudio ? 'aac' : 'copy', ...(encodeAudio ? ['-b:a', '192k'] : [])] : []),
        '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', staged.clean]);
    } else {
      const filters = [];
      const count = timeline.segments.length;
      filters.push(`[0:v]split=${count}${timeline.segments.map((_, i) => `[vs${i}]`).join('')}`);
      if (hasAudio) filters.push(`[${audioIndex}:a]asplit=${count}${timeline.segments.map((_, i) => `[as${i}]`).join('')}`);
      timeline.segments.forEach((segment, i) => {
        filters.push(`[vs${i}]trim=start=${segment.start}:end=${segment.end},setpts=(PTS-STARTPTS)/${timeline.speed}[v${i}]`);
        if (hasAudio) filters.push(`[as${i}]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS,atempo=${timeline.speed}[a${i}]`);
      });
      filters.push(`${timeline.segments.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('')}`
        + `concat=n=${count}:v=1:a=${hasAudio ? 1 : 0}[v]${hasAudio ? '[a]' : ''}`);
      fs.writeFileSync(path.join(stage, 'edit.txt'), filters.join(';\n'));
      run([...inputArgs, '-filter_complex_script', 'edit.txt', '-map', '[v]', ...(hasAudio ? ['-map', '[a]'] : []),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', staged.clean]);
    }
    if (subtitle) {
      fs.writeFileSync(staged.srt, formatSrt(finalCues));
      const ass = formatAss(finalCues, video.width, video.height, config.captionStyle ?? {});
      fs.writeFileSync(staged.ass, ass);
      fs.writeFileSync(path.join(stage, 'captions.ass'), ass);
    }
    if (burn) {
      run(['-i', staged.clean, '-vf', 'ass=filename=captions.ass', '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
        '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', staged.captioned]);
    }
    const warnings = finalCues.filter((cue) => cue.text.replace(/\s/g, '').length / (cue.end - cue.start) > 22).length;
    fs.writeFileSync(staged.report, JSON.stringify({ source, audio, captions: subtitle, sourceDuration: duration,
      outputDuration: timeline.duration, speed: timeline.speed, cuts: timeline.cuts, segments: timeline.segments,
      outputs, captionCount: finalCues.length, fastCaptionCount: warnings,
      note: 'Timing is transformed from supplied captions. Speech alignment is not inferred.' }, null, 2));
    for (const [key, destination] of Object.entries(outputs)) fs.copyFileSync(staged[key], destination, fs.constants.COPYFILE_EXCL);
    console.log(`[delivery] ${timeline.duration.toFixed(2)}s; ${finalCues.length} captions; ${warnings} fast cues.\n${JSON.stringify(outputs, null, 2)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

const specPath = process.argv[2];
if (!specPath || specPath === '--help') {
  console.log('Usage: node deliver-video.mjs <delivery.json>\nFields: source, outputPrefix, captions, audio, speed, cuts, burnCaptions, captionStyle. Paths are relative to the JSON file.');
  if (!specPath) process.exitCode = 1;
} else {
  deliverVideo(specPath);
}
