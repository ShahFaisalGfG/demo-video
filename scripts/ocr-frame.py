import argparse
import json
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR


def average_hash(image_path: Path) -> str:
    """Return a compact luminance hash for visual comparisons."""
    image = Image.open(image_path).convert("L").resize((16, 16))
    pixels = list(image.getdata())
    mean = sum(pixels) / len(pixels)
    return "".join("1" if value >= mean else "0" for value in pixels)


def main() -> None:
    """Read one image and emit OCR text plus a perceptual hash."""
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    args = parser.parse_args()
    image_path = Path(args.image)
    engine = RapidOCR()
    result, _ = engine(str(image_path))
    lines = [item[1].strip() for item in (result or []) if item[1].strip()]
    print(json.dumps({"text": " ".join(lines), "lines": lines, "hash": average_hash(image_path)}))


if __name__ == "__main__":
    main()
