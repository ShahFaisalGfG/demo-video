# Demo Video v1.6.0 - Release Notes

**Released:** October 2026 · **Status:** Stable · **Platform:** Windows, Linux and macOS · **Agents:** Claude Code, Codex, Cursor and other Agent Skills hosts

---

Demo Video is an Agent Skill that turns a website or desktop workflow into a polished, narrated MP4 with synchronized captions, and proves that the final video shows what the narration promises. v1.6.0 makes the video look and sound like a person made it: Kokoro becomes the default voice, the cursor moves like a hand, and speech recognition checks the narration before delivery. It also closes several quality gaps found while producing a client verification video: mispronounced abbreviations, past-tense "read", stutter from fractional speed-ups, capture flashes, and a recorder limit that silently dropped the cursor and frame.

---

## Breaking Changes

- **Kokoro is the default narration engine.** A definition without `narrationConfig.engine` now uses Kokoro `am_michael` instead of Piper `en_US-ryan-medium`. Set `"engine": "piper"` to keep the previous voice. The first Kokoro run downloads 354 MB of model files.
- **Abbreviations are no longer spelled with spaces.** The built-in pronunciations now use plain capitals and hyphenated letters (`API`, `A-W-S`), because both engines read "A P I" as "a P I". Narration clips that contain built-in abbreviations are synthesized again.
- **Browser cursor motion is human by default.** `cursor.motion: "linear"` restores testreel's composited straight-line cursor.
- **`compact-silence.mjs --silence-speed` takes a whole number of 2 or more.** Gaps play at whole-number speeds.
- **`verify-video.mjs` fails on single-frame flashes.**

## Added

- **Kokoro narration.** Kokoro v1.0 runs in its own isolated environment with the full-precision model by default (`kokoroPrecision` selects `fp16` or `int8`). Each model download is checked against a pinned SHA-256 digest before it is kept, and one worker process serves a whole narration batch so the model loads once. `kokoroVoice`, `kokoroLang`, `kokoroModel`, and `kokoroVoices` select other voices and local files.
- **Piper as the second engine.** `engine: "piper"` selects it, and `fallbackEngine` accepts `"piper"` or `"tiny-tts"`. Narration within one definition that mixes voices because a fallback ran for only some clips stops the render.
- **Human cursor in browser recordings.** The cursor is drawn inside the page and follows curved, minimum-jerk reaches with Fitts-law timing and a small overshoot on long reaches, with ripples on clicks and cursor styles that follow the element underneath. Paths are seeded by the definition, so the same page layout gives the same paths, and there is no limit on cursor moves. The cursor is drawn from pixel data, so the page's content security policy stays in force. With the human cursor, `zoom` steps use a sharp CSS zoom of the page.
- **Human input in desktop recordings.** The desktop runner moves the system pointer along the same paths, rests before clicks, holds the button for a human press length, drags along a path, types with a varied rhythm, and scrolls in steps (`capture.motion`).
- **Foreground-window guard.** On Windows, `capture.windowTitle` stops a desktop take the moment another window takes the foreground.
- **Narration verification.** `verify-narration.mjs` transcribes every clip, and with `--video` the finished soundtrack, using faster-whisper `large-v3-turbo`; compares the words with the captions; measures each caption's start against the speech with `--srt`; and lists heteronyms with their phonemes for tense and stress review.
- **Per-step spoken text.** `spokenNarration` changes what the voice says while the caption keeps `narration`, for example past-tense "read" spoken as "red".
- **Audible abbreviation plurals.** "IDs" and "PDFs" are spoken as "I-Dees" and "P-D-Effs" so the plural stays audible.
- **Flash detection.** `verify-video.mjs` fails on frames much darker or brighter than their neighbours and lists frames that jump away and return within twelve frames at 30 fps (errors with `--strict`).
- **Desktop deglitch.** `quality.deglitch: true` replaces repaint flashes and returning jumps in desktop captures with the last good frame before muxing.
- **Kokoro and Piper readiness** in `doctor.mjs`.

## Changed

- `compact-silence.mjs` speeds up silent gaps by whole numbers only and keeps the source frame rate, so motion no longer stutters.
- The recorder and `compile-video.mjs` refuse a capture whose testreel post-processing failed, instead of keeping a video without its cursor, window chrome, and background.
- Linear cursor recordings with more than 48 cursor moves stop with a clear message; testreel's FFmpeg expression cannot composite more.
- The Kokoro, alignment, OCR, and desktop environments share one self-healing lifecycle (`scripts/lib/python-venv.mjs`); the OCR environment now finds `python3` on Linux and macOS, and the desktop environment checks OpenCV and NumPy.
- The desktop runner applies `capture.platforms` overrides, as the recorder already did.
- Narration manifests record each clip's engine and voice.
- Templates use Kokoro and human motion; the desktop template adds the window guard and deglitch.

---

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer for Kokoro, Piper, subtitle alignment, narration verification, OCR, or desktop automation
- Internet access for the first browser and model download (Kokoro: 354 MB at full precision; narration verification: about 1.6 GB for `large-v3-turbo`)
- At least 4 GB of free cache space; more when using local VLMs

---

## Installing

1. Download `demo-video_1.6.0_skill.zip` below and check it against `demo-video_1.6.0_skill.zip.sha256`.
2. Unzip it and run `node demo-video/scripts/install-skill.mjs --host all --force` to replace an earlier installation (the previous copy is kept as a backup), or copy the `demo-video` folder into one skill directory yourself.
3. Run `node <installed-skill>/scripts/bootstrap.mjs`, then `node ~/.demo_video/scripts/doctor.mjs` to check what this PC supports.

---

*Show it. Say it. Prove it.* 🎬
