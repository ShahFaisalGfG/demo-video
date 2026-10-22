<div align="center">

# Demo Video

**An Agent Skill that records narrated product demos and step-by-step tutorials of websites and desktop apps - framed, captioned, and verified.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-0078D4.svg)](#platform-coverage)
[![Agents](https://img.shields.io/badge/Agents-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-8A2BE2.svg)](#supported-agents)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=nodedotjs&logoColor=white)](#requirements)

</div>

---

Demo Video is a portable [Agent Skill](SKILL.md) that turns a website or desktop workflow into a polished MP4. Your coding agent writes a recording definition, records the flow through Playwright or native screen capture, narrates it with a local Piper voice, adds synchronized captions, and checks the encoded video for the evidence the narration promises. Everything runs on your machine, in an isolated runtime that never touches the project being demonstrated.

> *Show it. Say it. Prove it.*

---

## Table of Contents

- [Demo Video](#demo-video)
  - [Table of Contents](#table-of-contents)
  - [Who Is This For?](#who-is-this-for)
  - [Why Demo Video?](#why-demo-video)
  - [Features](#features)
  - [Download \& Install](#download--install)
    - [Supported agents](#supported-agents)
    - [Requirements](#requirements)
  - [Quick Start](#quick-start)
  - [Platform Coverage](#platform-coverage)
  - [Application Coverage](#application-coverage)
  - [Local Models](#local-models)
  - [Security](#security)
  - [Development \& Tests](#development--tests)
  - [Versioning \& Releases](#versioning--releases)
  - [Contributing](#contributing)
  - [Changelog](#changelog)
    - [v1.5.0 - October 2026 *(current)*](#v150---october-2026-current)
  - [License \& Credits](#license--credits)
  - [Support the Project](#support-the-project)

---

## Who Is This For?

- **Developers** who need a demo of the feature they just shipped, without opening a video editor
- **Product teams** producing release walkthroughs, onboarding videos, and how-to guides
- **Agencies and freelancers** delivering client demos with clean and captioned versions
- **Trainers and support teams** who keep tutorials current as the product changes

---

## Why Demo Video?

Screen recordings drift out of date, and redoing one by hand means recording, narrating, captioning, and editing all over again. Demo Video makes the demo a file your agent can rerun.

- 🎬 **Recorded from a definition** - verified selectors and actions, so the next release is one command away
- 🗣️ **Local narration** - Piper voices run offline, cached per sentence, with pronunciation rules for product names
- 💬 **Captions that match the speech** - phrase-level cues aligned to detected speech, in ASS and SRT
- ✅ **Proof, not hope** - DOM, OCR, and image checks confirm the encoded frames show what the narration says
- 🧪 **Isolated runtime** - browsers, models, and Python environments live under `~/.demo_video`, never in your project

---

## Features

- **Website recording** through Playwright with verified DOM selectors and state-aware actions: `check`, `uncheck`, `clickResponse`, `assert`, `if`, and `upload`
- **Native desktop recording** on Windows, Linux X11, and macOS, with coordinate, ratio, and image-based actions
- **Presentation stage** - a dark stage with window chrome, a large cursor, click ripples, controlled scrolls, and focus zooms, rendered at 2560x1440 for client demos
- **Piper narration** with automatic voice selection, pronunciation dictionaries, audio mastering, and a cache that reuses unchanged clips
- **Captions** generated from measured narration timing and aligned to speech with faster-whisper
- **Paired delivery** - clean MP4, captioned MP4, ASS, and SRT from one timeline that stays synchronized after cuts and speed changes
- **Fast revisions** - replace audio without re-recording, cut intervals, change speed, and patch a short section of a long H.264 video without a full re-encode
- **Evidence gates** - DOM evidence, OCR and reference-image checks on final frames, and optional semantic checks through a local Qwen3-VL endpoint
- **Quality checks** - blank and loading frame detection, pacing analysis, lossless merging of split recordings, and stream checks on the final MP4
- **Hardware encoding** with NVENC, Quick Sync, AMF, VAAPI, or VideoToolbox when it preserves detail, and `libx264` otherwise

---

## Download & Install

Download `demo-video_<version>_skill.zip` from the [latest release](https://github.com/ShahFaisalGfG/demo-video/releases/latest), check it against its `.sha256` file, and unzip it. The zip holds one `demo-video` folder. Or clone the repository:

```bash
git clone https://github.com/ShahFaisalGfG/demo-video.git
```

Install into every supported agent's user skill folder:

```bash
node demo-video/scripts/install-skill.mjs --host all
```

Use `--host codex`, `claude`, `cursor`, or `agents` for one target, or `--destination <folder>` for another skill folder. Existing installations are kept unless `--force` is supplied, which moves the previous copy aside as a timestamped backup.

### Supported agents

The skill follows the Agent Skills `SKILL.md` format:

| Agent | Skill folder |
| --- | --- |
| Claude Code | `~/.claude/skills/demo-video` |
| Codex | `~/.codex/skills/demo-video` (or `$CODEX_HOME/skills`) |
| Cursor | `~/.cursor/skills/demo-video` |
| Shared Agent Skills location | `~/.agents/skills/demo-video` |

### Requirements

- Node.js 20 or newer
- Python 3.10 or newer for Piper, subtitle alignment, OCR, or desktop automation
- Internet access for the first model and browser download
- At least 2 GB of free cache space; more when using local VLMs

---

## Quick Start

1. Bootstrap the isolated runtime and check what this PC supports:

   ```bash
   node <installed-skill>/scripts/bootstrap.mjs
   node ~/.demo_video/scripts/doctor.mjs
   ```

   Bootstrap stores runtimes, browser binaries, models, and caches under `~/.demo_video`. It does not modify the target application's dependencies. It is fast after the first run.

2. Ask your agent for a video. For example, in Codex:

   > Use $demo-video to create a clear tutorial of the sign-up flow at http://localhost:3000, with Piper narration, focused interactions, and captioned and clean versions.

   In Claude Code, describe the video you want or run `/demo-video`.

3. The agent follows [SKILL.md](SKILL.md): it confirms the flow and deliverables, writes a recording definition from [template.recording.json](template.recording.json) or [template.desktop-recording.json](template.desktop-recording.json), verifies the steps, renders the narrated video, and runs the final quality gate.

For a new guide, the agent follows the [tutorial direction](references/tutorials.md). For final files and revisions, it uses the [delivery workflow](references/delivery.md). [reference.md](reference.md) holds the schemas and advanced options.

---

## Platform Coverage

| Capability | Windows | Linux | macOS |
|---|---|---|---|
| Website recording | Supported | Supported | Supported |
| Electron/WebView through a debug URL | Supported | Supported | Supported |
| Native desktop capture | `gdigrab` | X11 `x11grab` | `avfoundation` |
| Native input automation | PyAutoGUI | PyAutoGUI on X11 | PyAutoGUI |
| Hardware video encoding | NVENC, Quick Sync, AMF | NVENC, Quick Sync, VAAPI when FFmpeg supports it | VideoToolbox |
| CPU fallback | `libx264` | `libx264` | `libx264` |

Linux Wayland capture varies by compositor and security policy. Use an X11 session, OBS or portal capture, or pass a verified silent recording through `compile-video.mjs --reuse-video`.

macOS native capture requires Screen Recording permission. Native automation requires Accessibility permission. Native UI layouts must remain stable during coordinate or image-based automation.

---

## Application Coverage

- Websites and browser applications use verified DOM selectors and receive the strongest automation and evidence checks.
- Electron, Tauri, and embedded-WebView applications should expose a development or remote-debug URL when possible, allowing the website recorder to use DOM selectors.
- Native Windows, Linux X11, and macOS applications use the desktop recording definition in `template.desktop-recording.json`.
- Mobile applications can be demonstrated through a desktop mirror, emulator, or supplied silent capture.
- Applications protected against capture or automation require a user-supplied recording.

---

## Local Models

- Piper is the primary narration engine. The default `en_US-ryan-medium` voice downloads once and remains cached. Piper failures stop the render; TinyTTS runs only when `fallbackEngine: "tiny-tts"` is set.
- faster-whisper aligns captions to speech and can score voice pronunciation.
- Qwen3-VL semantic evidence works through an OpenAI-compatible local endpoint. Set `DEMO_VLM_BASE_URL` and optionally `DEMO_VLM_MODEL`.

No remote semantic endpoint is contacted unless `quality.semanticEvidence` is configured.

---

## Security

- Keep credentials in environment variables, never in recording definitions.
- Treat recording definitions as executable UI automation and review them before running.
- Use dedicated test accounts and non-production data.
- Use local semantic endpoints for confidential screens.
- Review third-party model licenses before client use.
- Check release checksums before distribution.

See [SECURITY.md](SECURITY.md) for reporting a vulnerability.

---

## Development & Tests

After changing the skill, run its checks from the repository root:

```bash
node scripts/bootstrap.mjs
node ~/.demo_video/scripts/self-test.mjs
node ~/.demo_video/scripts/release-test.mjs
python scripts/desktop-runner.py tests/desktop-smoke.recording.json --validate
```

`bootstrap.mjs` syncs the scripts into `~/.demo_video`, so run it again after every edit before testing. The self-test covers the owned recorder, conditional and response-bound actions, cached voice selection, narration pronunciation, audio mastering, pacing analysis, encoder selection, and GOP patching; add `--with-ocr` for OCR evidence or `--with-asr` for pronunciation scoring when the tiny faster-whisper model is cached. The release test checks paired delivery and narration revisions.

[CI](.github/workflows/ci.yml) runs these checks on Windows, Linux, and macOS for every push and pull request, plus the OCR evidence test on Windows.

---

## Versioning & Releases

Demo Video follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. The version lives in one place, the [VERSION](VERSION) file. Releases are tagged `v<version>` and published as **Demo Video v\<version\>** with three files:

| File | Contents |
| --- | --- |
| `demo-video_<version>_skill.zip` | The skill in one `demo-video` folder, with fixed timestamps so the same source always gives the same zip |
| `demo-video_<version>_skill.zip.sha256` | The zip's SHA-256 checksum |
| `release-manifest.json` | Name, version, archive name, checksum, and file count |

Build the same files locally with:

```bash
python scripts/package-skill.py . ./dist
```

To release a version:

1. Update [VERSION](VERSION) and write `release_notes/release_notes_v<version>.md`.
2. Add the version to the [Changelog](#changelog) below.
3. Tag the release commit and push the tag:

   ```bash
   git tag v1.5.0
   git push origin v1.5.0
   ```

The [Build and Release](.github/workflows/build-release.yml) workflow checks that the tag matches `VERSION` and that the release notes exist, runs the full CI suite, packages the skill, and publishes the GitHub release.

---

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes and run the checks in [Development & Tests](#development--tests)
3. Commit with a clear message and open a **Pull Request** targeting `main`

Keep credentials, client recordings, and generated media out of commits.

---

## Changelog

### v1.5.0 - October 2026 *(current)*
- 🎓 **Tutorial direction** for demos, how-to guides, and training videos
- 🎞️ **Paired delivery:** clean and captioned MP4s with synchronized ASS and SRT captions from one timeline
- ✂️ **Fast revisions:** replace audio without re-recording, cut intervals, and change speed
- 🗣️ **Cached Piper narration** with working speed control; Piper stays the default and a fallback engine must be configured explicitly
- 🛡️ **Stale-audio detection** and **offline capture reuse** with `--reuse-video`
- 📦 Release archives named `demo-video_<version>_skill.zip`, with a checksum and manifest

[Full release notes →](release_notes/)

---

## License & Credits

Released under the [MIT License](LICENSE) - free to use, modify, and distribute. The skill downloads or invokes third-party tools and models, each under its own license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A tool's license and the license of the media it generates are separate questions, so review the model card of every voice and model before client delivery.

Built with Playwright, testreel, FFmpeg, Piper, faster-whisper, RapidOCR, and PyAutoGUI.

Built with ❤️ by **Shah Faisal** · [Portfolio](https://shahfaisalgfg.github.io/) · [shahfaisalgfg@gmail.com](mailto:shahfaisalgfg@gmail.com)

---

## Support the Project

- ⭐ **Star the repo** - it helps others find the project
- 🐛 **Report a bug** - a flow that won't record is worth an issue
- 💡 **Suggest a feature** - a new capture source, voice, or delivery format
- 🛠️ **Contribute code** - see [Contributing](#contributing)

---

*Show it. Say it. Prove it.* 🎬
