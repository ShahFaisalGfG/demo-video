import { execFileSync } from 'node:child_process';
import os from 'node:os';
import ffmpegPath from 'ffmpeg-static';

const ENCODERS = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-b:v', '0'],
  h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '20'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-q:v', '65'],
  libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'],
};

function candidates() {
  if (process.platform === 'win32') return ['h264_nvenc', 'h264_qsv', 'h264_amf'];
  if (process.platform === 'darwin') return ['h264_videotoolbox'];
  return ['h264_nvenc', 'h264_qsv'];
}

function works(name) {
  if (!ENCODERS[name]) return false;
  const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
  try {
    execFileSync(ffmpegPath, [
      '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=1', '-frames:v', '1',
      ...ENCODERS[name], '-f', 'null', nullOutput,
    ], { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export function selectEncoder(requested = process.env.DEMO_VIDEO_ENCODER ?? 'auto') {
  if (requested !== 'auto') {
    if (!ENCODERS[requested]) throw new Error(`Unsupported video encoder: ${requested}`);
    if (requested !== 'libx264' && !works(requested)) {
      throw new Error(`Requested encoder ${requested} is unavailable on ${os.platform()}.`);
    }
    return { name: requested, args: ENCODERS[requested] };
  }
  for (const candidate of candidates()) {
    if (works(candidate)) return { name: candidate, args: ENCODERS[candidate] };
  }
  return { name: 'libx264', args: ENCODERS.libx264 };
}
