"""Transcribe narration with faster-whisper and compare it word for word with the script."""
import argparse
import difflib
import io
import json
import re
import sys
from pathlib import Path

from faster_whisper import WhisperModel

NUMBERS = dict(enumerate(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                          "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
                          "nineteen", "twenty"]))
LOW_CONFIDENCE = 0.5


def tokens(text: str) -> list[str]:
    """Lower-case words with symbols spoken, apostrophes joined, and small numbers spelled out."""
    text = text.lower().replace("’", "'").replace("@", " at ").replace("&", " and ").replace("%", " percent ")
    text = re.sub(r"(\w)'(\w)", r"\1\2", text)
    return [NUMBERS[int(word)] if word.isdigit() and int(word) <= 20 else word
            for word in re.findall(r"[a-z0-9]+", text)]


def letters(words: list[str]) -> str:
    """Join words so spacing and hyphenation differences compare equal."""
    return "".join(words)


def span(start: int, end: int) -> tuple[float, float]:
    """Heard positions a difference covers; a missing word sits between two positions."""
    return (start, end) if end > start else (start - 0.5, start - 0.5)


def overlaps(left: tuple[float, float], right: tuple[float, float]) -> bool:
    """Whether two heard spans share a position."""
    if left[0] == left[1] and right[0] == right[1]:
        return left[0] == right[0]
    if left[0] == left[1]:
        return right[0] < left[0] < right[1]
    if right[0] == right[1]:
        return left[0] < right[0] < left[1]
    return left[0] < right[1] and right[0] < left[1]


def compare(expected: list[str], heard: list[str], pairs: set[tuple[str, str]]) -> list[dict]:
    """Word groups that differ from one expected stream, after joined-letter and configured matches."""
    found = []
    for op, a, b, c, d in difflib.SequenceMatcher(None, expected, heard, autojunk=False).get_opcodes():
        want, got = letters(expected[a:b]), letters(heard[c:d])
        if op == "equal" or want == got or (want, got) in pairs:
            continue
        found.append({"expected": " ".join(expected[a:b]), "heard": " ".join(heard[c:d]), "span": span(c, d)})
    return found


def differences(written: list[str], spoken: list[str], heard: list[str], pairs: set) -> list[dict]:
    """Word groups that differ from both the caption and the spoken text; a pronunciation entry or spoken override
    matches one of the two, so only a word the voice or the recognizer got wrong differs from both."""
    against_spoken = compare(spoken, heard, pairs)
    return [{"expected": item["expected"], "heard": item["heard"]} for item in compare(written, heard, pairs)
            if any(overlaps(item["span"], other["span"]) for other in against_spoken)]


def known_pairs(equivalents: dict) -> set[tuple[str, str]]:
    """Configured recognizer spellings, as (written, heard) joined-letter pairs."""
    return {(letters(tokens(written)), letters(tokens(heard))) for heard, written in equivalents.items()}


def transcribe(model: WhisperModel, audio: str, vad: bool) -> list:
    """Recognized words with timestamps and confidence."""
    segments, _ = model.transcribe(audio, language="en", word_timestamps=True, beam_size=5,
                                   condition_on_previous_text=False, vad_filter=vad)
    return [word for segment in segments for word in segment.words]


def weak_words(heard: list) -> list[str]:
    """Words the recognizer was unsure of, worth a listen."""
    return [f"{word.word.strip()} ({word.probability:.2f})" for word in heard if word.probability < LOW_CONFIDENCE]


def check_clips(model: WhisperModel, clips: list[dict], pairs: set) -> list[dict]:
    """Compare every clip's transcript with its caption text."""
    results = []
    for clip in clips:
        heard = transcribe(model, clip["audio"], vad=False)
        transcript = "".join(word.word for word in heard).strip()
        found = differences(tokens(clip["text"]), tokens(clip["spoken"]), tokens(transcript), pairs)
        results.append({"name": clip["name"], "text": clip["text"], "spoken": clip["spoken"], "heard": transcript,
                        "differences": found, "lowConfidence": weak_words(heard)})
        print(f"{'MATCH' if not found else 'DIFF '} {clip['name']}: {transcript}", flush=True)
        for item in found:
            print(f"      expected {item['expected']!r}, heard {item['heard']!r}", flush=True)
    return results


def check_soundtrack(model: WhisperModel, video: str, cues: list[dict], spoken: list[str], pairs: set,
                     max_offset: float) -> dict:
    """Compare the finished soundtrack with the script in order, and each cue's start with where it was heard."""
    heard = transcribe(model, video, vad=True)
    expected, starts = [], []
    for cue in cues:
        starts.append((cue, len(expected)))
        expected += tokens(cue["text"])
    heard_tokens, heard_times = [], []
    for word in heard:
        parts = tokens(word.word)
        heard_tokens += parts
        heard_times += [word.start] * len(parts)
    found = differences(expected, [word for line in spoken for word in tokens(line)], heard_tokens, pairs)
    mapping = {}
    for a, c, size in difflib.SequenceMatcher(None, expected, heard_tokens, autojunk=False).get_matching_blocks():
        mapping.update({a + k: c + k for k in range(size)})
    offsets = []
    for cue, index in starts:
        if cue.get("start") is None:
            continue
        matched = next((mapping[i] for i in range(index, index + 4) if i in mapping), None)
        heard_at = heard_times[matched] if matched is not None else None
        offsets.append({"text": cue["text"], "start": cue["start"],
                        "heard": None if heard_at is None else round(heard_at, 2),
                        "offset": None if heard_at is None else round(heard_at - cue["start"], 2)})
    measured = [abs(item["offset"]) for item in offsets if item["offset"] is not None]
    largest = max(measured, default=0.0)
    missing = [item["text"] for item in offsets if item["offset"] is None]
    print(f"soundtrack: {len(expected)} script words, {len(heard_tokens)} heard, {len(found)} difference(s)", flush=True)
    for item in found:
        print(f"      expected {item['expected']!r}, heard {item['heard']!r}", flush=True)
    if offsets:
        print(f"      largest cue offset {largest:.2f} s; cues not found: {len(missing)}", flush=True)
    return {"video": video, "scriptWords": len(expected), "heardWords": len(heard_tokens), "differences": found,
            "offsets": offsets, "largestOffset": largest, "cuesNotFound": missing,
            "passed": not found and largest <= max_offset and not missing, "lowConfidence": weak_words(heard)}


def main() -> None:
    """Read the request file, run the checks, and write the report file."""
    parser = argparse.ArgumentParser()
    parser.add_argument("request")
    parser.add_argument("report")
    args = parser.parse_args()
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    model = WhisperModel(request["model"], device="cpu", compute_type="int8")
    pairs = known_pairs(request.get("equivalents", {}))
    report = {"model": request["model"], "clips": check_clips(model, request["clips"], pairs)}
    if request.get("video"):
        report["soundtrack"] = check_soundtrack(model, request["video"], request["cues"],
                                                [clip["spoken"] for clip in request["clips"]], pairs,
                                                request.get("maxOffset", 1.0))
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
