# Demo Video v1.5.0 - Release Notes

**Released:** October 2026 · **Status:** Stable · **Platform:** Windows, Linux and macOS · **Agents:** Claude Code, Codex, Cursor and other Agent Skills hosts

---

Demo Video is an Agent Skill that turns a website or desktop workflow into a polished, narrated MP4 with synchronized captions, and proves that the final video shows what the narration promises. v1.5.0 is the first published release. It adds tutorial direction for demos, how-to guides and training videos, cached Piper narration with working speed control, stale-audio detection, offline capture reuse, and paired video delivery with synchronized ASS and SRT captions.

---

## Breaking Changes

None for recording definitions. Release archives are now named `demo-video_<version>_skill.zip` (previously `demo-video-<version>.zip`), with a matching `.sha256` file.

---

## Added

- **Tutorial direction.** `references/tutorials.md` guides new demos, how-to guides and training videos: the viewer's outcome first, one idea per narrated step, focus zooms on the control being explained.
- **Paired delivery.** `deliver-video.mjs` exports the clean video, a version with burned-in captions, white bold ASS captions on black boxes, and an SRT file from one timeline. One source-time edit map keeps every variant synchronized after cuts and speed changes. See `references/delivery.md`.
- **Fast revisions.** The delivery command replaces audio without re-recording, removes chosen intervals, and changes speed.
- **Cached Piper narration.** Unchanged narration clips are reused by spoken text and voice settings, and speed control applies to Piper.
- **Stale-audio detection.** The compiler refuses narration that no longer matches its recording definition.
- **Offline capture reuse.** `compile-video.mjs --reuse-video` renders from an existing silent capture, for example on Wayland or for applications that block automation.

## Included

- **Browser recording** through Playwright with verified DOM selectors, state-aware actions (`check`, `clickResponse`, `assert`, `if`, `upload`) and a dark presentation stage with window chrome, a large cursor, click ripples and focus zooms.
- **Native desktop recording** on Windows (`gdigrab`), Linux X11 (`x11grab`) and macOS (`avfoundation`) with PyAutoGUI automation, including image-based clicks and assertions.
- **Local narration** with Piper (`en_US-ryan-medium` by default), automatic voice selection from candidates, pronunciation rules and audio mastering. TinyTTS is available as an explicit fallback.
- **Captions** generated from measured narration timing and aligned to detected speech with faster-whisper.
- **Evidence checks:** DOM evidence, OCR and reference-image checks on encoded frames, and optional semantic checks through a local Qwen3-VL endpoint.
- **Editing tools:** lossless merging of split recordings, silence compaction, pacing analysis, and GOP-window patching that re-encodes only the repaired seconds of a long H.264 video.
- **An isolated runtime** under `~/.demo_video`: npm packages, Chromium, Python environments and models never touch the project being demonstrated.

---

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer for Piper, subtitle alignment, OCR, or desktop automation
- Internet access for the first browser and model download
- At least 2 GB of free cache space; more when using local VLMs

---

## Installing

1. Download `demo-video_1.5.0_skill.zip` below and check it against `demo-video_1.5.0_skill.zip.sha256`.
2. Unzip it and run `node demo-video/scripts/install-skill.mjs --host all` to install it for Codex, Claude Code, Cursor and the shared Agent Skills folder, or copy the `demo-video` folder into one skill directory yourself.
3. Run `node <installed-skill>/scripts/bootstrap.mjs`, then `node ~/.demo_video/scripts/doctor.mjs` to check what this PC supports.

Existing installations are kept unless `install-skill.mjs` runs with `--force`, which first moves the previous copy aside as a backup.

---

*Show it. Say it. Prove it.* 🎬
