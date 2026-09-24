import argparse
import re
from pathlib import Path

from faster_whisper import WhisperModel


def format_time(seconds: float) -> str:
    millis = max(0, round(seconds * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, remainder = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{remainder:03d}"


def wrap(words: list[str], max_line_chars: int) -> str:
    text = " ".join(words)
    if len(text) <= max_line_chars:
        return text
    best: tuple[int, str, str] | None = None
    for split in range(1, len(words)):
        first = " ".join(words[:split])
        second = " ".join(words[split:])
        score = max(len(first), len(second)) * 10 + abs(len(first) - len(second))
        if best is None or score < best[0]:
            best = (score, first, second)
    return f"{best[1]}\n{best[2]}" if best else text


def group_words(words: list[dict], max_words: int, max_line_chars: int) -> list[dict]:
    cues: list[dict] = []
    current: list[dict] = []
    for word in words:
        candidate = current + [word]
        candidate_text = " ".join(item["word"] for item in candidate)
        if current and (len(candidate) > max_words or len(candidate_text) > max_line_chars * 2):
            cues.append({"words": current})
            current = [word]
        else:
            current = candidate
        if len(current) >= 4 and current[-1]["word"].endswith((".", "?", "!", ";", ":")):
            cues.append({"words": current})
            current = []
    if current:
        cues.append({"words": current})
    merged: list[dict] = []
    for cue in cues:
        duration = cue["words"][-1]["end"] - cue["words"][0]["start"]
        if duration < 0.65 and merged:
            combined = merged[-1]["words"] + cue["words"]
            if len(combined) <= max_words * 2 and len(" ".join(item["word"] for item in combined)) <= max_line_chars * 2:
                merged[-1]["words"] = combined
                continue
        merged.append(cue)
    for index in range(1, len(merged)):
        cue = merged[index]
        duration = cue["words"][-1]["end"] - cue["words"][0]["start"]
        if duration < 0.65:
            combined = merged[index - 1]["words"] + cue["words"]
            split = max(1, min(len(combined) - 1, (len(combined) + 1) // 2))
            merged[index - 1]["words"] = combined[:split]
            merged[index]["words"] = combined[split:]
    return merged


def parse_time(value: str) -> float:
    hours, minutes, remainder = value.split(":")
    seconds, millis = remainder.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_srt(path: str) -> list[dict]:
    cues = []
    for block in re.split(r"\r?\n\r?\n", Path(path).read_text(encoding="utf-8").strip()):
        lines = block.splitlines()
        timing_index = next(index for index, line in enumerate(lines) if " --> " in line)
        start, end = lines[timing_index].split(" --> ")
        cues.append({
            "start": parse_time(start),
            "end": parse_time(end),
            "text": " ".join(lines[timing_index + 1:]).strip(),
        })
    return cues


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def lcs_anchors(source: list[str], detected: list[dict]) -> list[tuple[int, dict]]:
    rows = len(source) + 1
    cols = len(detected) + 1
    table = [[0] * cols for _ in range(rows)]
    for i in range(1, rows):
        for j in range(1, cols):
            if normalized(source[i - 1]) == normalized(detected[j - 1]["word"]):
                table[i][j] = table[i - 1][j - 1] + 1
            else:
                table[i][j] = max(table[i - 1][j], table[i][j - 1])
    anchors = []
    i, j = len(source), len(detected)
    while i and j:
        if normalized(source[i - 1]) == normalized(detected[j - 1]["word"]):
            anchors.append((i - 1, detected[j - 1]))
            i -= 1
            j -= 1
        elif table[i - 1][j] >= table[i][j - 1]:
            i -= 1
        else:
            j -= 1
    return list(reversed(anchors))


def source_words(source_cues: list[dict], detected_words: list[dict]) -> list[dict]:
    aligned = []
    for cue in source_cues:
        words = cue["text"].split()
        detected = [
            word for word in detected_words
            if word["end"] >= cue["start"] - 0.2 and word["start"] <= cue["end"] + 0.2
        ]
        anchors = lcs_anchors(words, detected)
        anchor_map = {index: word for index, word in anchors}
        boundaries = [(-1, cue["start"], cue["start"])] + [
            (index, word["start"], word["end"]) for index, word in anchors
        ] + [(len(words), cue["end"], cue["end"])]
        for index, text in enumerate(words):
            if index in anchor_map:
                word = anchor_map[index]
                aligned.append({"word": text, "start": word["start"], "end": word["end"]})
                continue
            previous = max(item for item in boundaries if item[0] < index)
            following = min(item for item in boundaries if item[0] > index)
            span_count = following[0] - previous[0] - 1
            position = index - previous[0] - 1
            available_start = previous[2]
            available_end = following[1]
            duration = max(0.05, available_end - available_start)
            start = available_start + duration * (position / max(1, span_count))
            end = available_start + duration * ((position + 1) / max(1, span_count))
            aligned.append({"word": text, "start": start, "end": end})
    return aligned


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate word-timestamped closed captions with faster-whisper.")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--model", default="tiny.en")
    parser.add_argument("--language", default="en")
    parser.add_argument("--max-words", type=int, default=8)
    parser.add_argument("--max-line-chars", type=int, default=39)
    parser.add_argument("--source-srt", help="Approved transcript text to align against detected word timestamps.")
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, transcription = model.transcribe(
        args.input,
        language=args.language,
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )
    detected_words: list[dict] = []
    for segment in segments:
        for word in segment.words or []:
            text = word.word.strip()
            if text:
                detected_words.append({"word": text, "start": word.start, "end": word.end})
    if args.source_srt:
        source_cues = [cue for cue in parse_srt(args.source_srt) if cue["start"] < transcription.duration]
        for cue in source_cues:
            cue["end"] = min(cue["end"], transcription.duration)
        words = source_words(source_cues, detected_words)
    else:
        words = detected_words
    cues = group_words(words, args.max_words, args.max_line_chars)
    for index in range(1, len(cues)):
        while (
            cues[index]["words"][-1]["end"] - cues[index]["words"][0]["start"] < 0.8
            and len(cues[index - 1]["words"]) > 3
        ):
            cues[index]["words"].insert(0, cues[index - 1]["words"].pop())
    blocks = []
    for index, cue in enumerate(cues, start=1):
        cue_words = cue["words"]
        text = wrap([item["word"] for item in cue_words], args.max_line_chars)
        blocks.append(
            f"{index}\n{format_time(cue_words[0]['start'])} --> {format_time(cue_words[-1]['end'])}\n{text}"
        )
    Path(args.output).write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    print(f"aligned {len(words)} words into {len(cues)} closed-caption cues")


if __name__ == "__main__":
    main()
