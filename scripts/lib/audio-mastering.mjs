import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const DEFAULT_MASTERING_FILTER = [
  'highpass=f=70',
  'lowpass=f=11500',
  'acompressor=threshold=0.125:ratio=3:attack=15:release=180:makeup=1.8',
  'loudnorm=I=-18:LRA=7:TP=-2',
  'alimiter=limit=0.95',
].join(',');

export function masterAudio(input, output, sampleRate, config = {}) {
  const filter = config.audioMasteringFilter ?? DEFAULT_MASTERING_FILTER;
  execFileSync(ffmpegPath, [
    '-i', input,
    '-af', filter,
    '-ar', String(sampleRate), '-ac', '1', '-c:a', 'pcm_s16le',
    '-y', output,
  ], { stdio: 'ignore' });
  return output;
}
