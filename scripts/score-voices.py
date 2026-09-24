import argparse
import json
import math
import re
import struct
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel


def normalize(value: str) -> str:
    """Normalize speech and reference text for tolerant comparison."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def edit_distance(left: str, right: str) -> int:
    """Return Levenshtein distance for two normalized strings."""
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_char in enumerate(right, start=1):
            current.append(min(
                current[-1] + 1,
                previous[right_index] + 1,
                previous[right_index - 1] + (left_char != right_char),
            ))
        previous = current
    return previous[-1]


def audio_metrics(path: str, word_count: int) -> dict:
    """Measure level, clipping, silence, duration, and speaking pace."""
    raw = Path(path).read_bytes()
    format_offset = raw.find(b"fmt ")
    data_offset = raw.find(b"data")
    if format_offset < 0 or data_offset < 0:
        raise ValueError("WAV format or data chunk is missing.")
    audio_format, channels, sample_rate = struct.unpack_from("<HHI", raw, format_offset + 8)
    bits = struct.unpack_from("<H", raw, format_offset + 22)[0]
    data_length = struct.unpack_from("<I", raw, data_offset + 4)[0]
    audio_data = raw[data_offset + 8:data_offset + 8 + data_length]
    if audio_format == 1 and bits == 16:
        samples = np.frombuffer(audio_data, dtype="<i2").astype(np.float32) / 32768.0
    elif audio_format == 3 and bits == 32:
        samples = np.frombuffer(audio_data, dtype="<f4").astype(np.float32)
    else:
        raise ValueError(f"Voice scoring supports PCM16 or float32 WAV, received {audio_format}/{bits}.")
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    duration = len(samples) / sample_rate
    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    dbfs = 20 * math.log10(max(rms, 1e-8))
    clipping = float(np.mean(np.abs(samples) >= 0.98))
    silence = float(np.mean(np.abs(samples) <= 0.012))
    pace = word_count / max(duration, 0.1)
    level_score = max(0.0, 1 - abs(dbfs + 18) / 18)
    clip_score = max(0.0, 1 - clipping * 200)
    silence_score = max(0.0, 1 - max(0.0, silence - 0.28) / 0.5)
    pace_score = max(0.0, 1 - abs(pace - 2.6) / 2.6)
    return {
        "duration": duration,
        "dbfs": dbfs,
        "clipping": clipping,
        "silence": silence,
        "wordsPerSecond": pace,
        "acousticScore": level_score * 0.35 + clip_score * 0.35 + silence_score * 0.15 + pace_score * 0.15,
    }


def main() -> None:
    """Score short candidate clips with one cached ASR model load."""
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("output")
    args = parser.parse_args()
    payload = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    model = WhisperModel(
        payload.get("model", "tiny.en"),
        device="cpu",
        compute_type="int8",
    )
    expected = normalize(payload["expected"])
    results = []
    for candidate in payload["candidates"]:
        segments, _ = model.transcribe(candidate["path"], language="en", vad_filter=True, beam_size=3)
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        observed = normalize(transcript)
        similarity = 1 - edit_distance(expected, observed) / max(1, len(expected), len(observed))
        metrics = audio_metrics(candidate["path"], candidate["wordCount"])
        score = max(0.0, similarity) * 0.75 + metrics["acousticScore"] * 0.25
        results.append({**candidate, **metrics, "transcript": transcript, "pronunciationSimilarity": similarity, "score": score})
    results.sort(key=lambda item: item["score"], reverse=True)
    Path(args.output).write_text(json.dumps({"selected": results[0]["id"], "results": results}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
