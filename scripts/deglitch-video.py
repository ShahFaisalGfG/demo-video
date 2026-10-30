"""Remove capture glitches from a desktop recording by repeating the last good frame.

Screen capture can catch a window mid-repaint: one blank or flashing frame, or a few frames that jump away
and return. A frame is replaced when it is a brightness spike against its neighbours, or when it differs from
the last good frame and a frame within the next twelve returns to that good frame. A change that stays (a
dialog opening, a scroll, a new page) is kept.
"""
import argparse
import json
import subprocess
from collections import deque
from typing import IO

import numpy as np

AHEAD = 12
AWAY = 5.0
BACK = 2.5


def thumb(frame: np.ndarray) -> np.ndarray:
    """A small grey copy of a frame for comparisons."""
    return frame[::8, ::8].mean(axis=2)


def is_flash(level: float, before: float, after: float) -> bool:
    """A frame much darker or brighter than the frames on both sides of it."""
    dark = level < 0.7 * before and level < 0.7 * after and min(before, after) - level > 6
    bright = level > 1.4 * before and level > 1.4 * after and level - max(before, after) > 6
    return dark or bright


def steady(frames, stats: dict):
    """Yield frames with glitches replaced by the last good frame."""
    ahead: deque = deque()
    good = None

    def settle():
        nonlocal good
        frame, small = ahead.popleft()
        if good is not None:
            away = np.abs(small - good[1]).mean() > AWAY
            returns = away and any(np.abs(later - good[1]).mean() <= BACK for _, later in ahead)
            upcoming = [float(later.mean()) for _, later in list(ahead)[:4]] or [float(small.mean())]
            if returns or is_flash(float(small.mean()), float(good[1].mean()), max(upcoming)):
                stats["replaced"] += 1
                return good[0]
        good = (frame, small)
        return frame

    for frame in frames:
        ahead.append((frame, thumb(frame)))
        if len(ahead) > AHEAD:
            yield settle()
    while ahead:
        yield settle()


def read_frames(source: IO[bytes], width: int, height: int):
    """Yield RGB frames from a raw FFmpeg pipe."""
    size = width * height * 3
    while True:
        data = source.read(size)
        if len(data) < size:
            return
        yield np.frombuffer(data, np.uint8).reshape(height, width, 3)


def main() -> None:
    """Stream the input through the filter into a high-quality H.264 file and print the replaced count."""
    parser = argparse.ArgumentParser()
    parser.add_argument("ffmpeg")
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("width", type=int)
    parser.add_argument("height", type=int)
    parser.add_argument("fps")
    args = parser.parse_args()
    reader = subprocess.Popen([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", args.source, "-an",
                               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    writer = subprocess.Popen([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt",
                               "rgb24", "-s", f"{args.width}x{args.height}", "-r", args.fps, "-i", "-",
                               "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast",
                               "-crf", "16", "-pix_fmt", "yuv420p",
                               "-y", args.output], stdin=subprocess.PIPE)
    if reader.stdout is None or writer.stdin is None:
        raise SystemExit("FFmpeg pipes did not open.")
    source, sink = reader.stdout, writer.stdin
    stats = {"frames": 0, "replaced": 0}
    try:
        for frame in steady(read_frames(source, args.width, args.height), stats):
            sink.write(frame.tobytes())
            stats["frames"] += 1
    except OSError as error:
        reader.kill()
        raise SystemExit(f"encoder stopped early: {error}") from error
    finally:
        try:
            sink.close()
        except OSError:
            reader.kill()
        reader.wait()
    if writer.wait() or reader.returncode:
        raise SystemExit("FFmpeg failed while removing capture glitches.")
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
