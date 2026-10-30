"""List the phonemes spoken for words that share a spelling but differ in sound or stress, for tense and stress review."""
import argparse
import io
import json
import re
import sys
from pathlib import Path

from kokoro_onnx.tokenizer import Tokenizer

HETERONYMS = {
    "read", "reads", "lead", "leads", "live", "lives", "record", "records", "present", "presents", "content",
    "close", "closes", "use", "uses", "minute", "object", "objects", "project", "projects", "produce", "subject",
    "permit", "permits", "refuse", "contract", "contracts", "conduct", "address", "addresses", "estimate",
    "estimates", "separate", "moderate", "attribute", "attributes", "invalid", "convert", "converts", "export",
    "exports", "import", "imports", "increase", "increases", "decrease", "decreases", "progress", "update",
    "updates", "upgrade", "upgrades", "insert", "inserts", "wind", "tear", "row", "bow", "wound", "desert",
}


def main() -> None:
    """Write each heteronym with five words of context and its phonemes."""
    parser = argparse.ArgumentParser()
    parser.add_argument("lines")
    parser.add_argument("report")
    args = parser.parse_args()
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    request = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    tokenizer = Tokenizer()
    found = []
    for line in request["lines"]:
        words = line["spoken"].split()
        for index, word in enumerate(words):
            bare = re.sub(r"[^\w'-]", "", word).lower()
            if bare in HETERONYMS:
                context = " ".join(words[max(0, index - 2):index + 3])
                found.append({"name": line["name"], "word": bare, "context": context,
                              "phonemes": tokenizer.phonemize(context, request["lang"])})
    Path(args.report).write_text(json.dumps(found, indent=2, ensure_ascii=False), encoding="utf-8")
    for item in found:
        print(f"{item['name']:<24} {item['word']:<10} {item['phonemes']:<36} | {item['context']}")


if __name__ == "__main__":
    main()
