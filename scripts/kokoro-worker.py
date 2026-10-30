"""Serve Kokoro narration over JSON lines: load the model once, then write one WAV clip per request."""
import io
import json
import sys

import soundfile
from kokoro_onnx import Kokoro


def answer(reply: dict) -> None:
    """Write one JSON reply line; stdout carries nothing else."""
    sys.stdout.write(json.dumps(reply) + "\n")
    sys.stdout.flush()


def main() -> None:
    """Read requests with id, text, output, voice, speed, and lang until stdin closes."""
    for stream in (sys.stdin, sys.stdout):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    model, voices = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(model, voices)
    known = set(kokoro.get_voices())
    answer({"ready": True, "voices": sorted(known)})
    for line in sys.stdin:
        if not line.strip():
            continue
        request: dict = {}
        try:
            request = json.loads(line)
            if request["voice"] not in known:
                raise ValueError(f"unknown Kokoro voice {request['voice']!r}")
            samples, rate = kokoro.create(request["text"], voice=request["voice"],
                                          speed=float(request["speed"]), lang=request["lang"])
            soundfile.write(request["output"], samples, rate, subtype="PCM_16")
            answer({"id": request["id"], "ok": True, "seconds": len(samples) / rate})
        except (KeyError, TypeError, IndexError, ValueError, RuntimeError, OSError) as error:
            answer({"id": request.get("id"), "ok": False, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
