import argparse
import hashlib
import json
import zipfile
from pathlib import Path


EXCLUDED = {".git", "dist", "__pycache__", ".DS_Store"}


def included(path: Path) -> bool:
    """Return whether a skill file belongs in a release archive."""
    return not any(part in EXCLUDED for part in path.parts) and not path.name.endswith((".partial", ".pyc"))


def main() -> None:
    """Create a deterministic portable Agent Skill zip and checksum file."""
    parser = argparse.ArgumentParser()
    parser.add_argument("skill")
    parser.add_argument("output")
    args = parser.parse_args()
    skill = Path(args.skill).resolve()
    output = Path(args.output).resolve()
    if not (skill / "SKILL.md").exists():
        raise ValueError("Skill root must contain SKILL.md.")
    version = (skill / "VERSION").read_text(encoding="utf-8").strip()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"demo-video-{version}.zip"
    files = sorted(path for path in skill.rglob("*") if path.is_file() and included(path.relative_to(skill)))
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for file in files:
            info = zipfile.ZipInfo(f"demo-video/{file.relative_to(skill).as_posix()}")
            info.date_time = (2026, 1, 1, 0, 0, 0)
            info.external_attr = 0o644 << 16
            package.writestr(info, file.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix(".zip.sha256")
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    manifest = {"name": "demo-video", "version": version, "archive": archive.name,
                "sha256": digest, "files": len(files)}
    (output / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
