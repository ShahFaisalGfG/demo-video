<div align="center">

# Demo Video

**An Agent Skill that records narrated product demos and step-by-step tutorials of websites and desktop apps - framed, captioned, and verified.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-0078D4.svg)](#platform-coverage)
[![Latest Release](https://img.shields.io/github/v/release/ShahFaisalGfG/demo-video?color=brightgreen&label=Latest%20Release)](https://github.com/ShahFaisalGfG/demo-video/releases/latest)
[![Agents](https://img.shields.io/badge/Agents-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-8A2BE2.svg)](#supported-agents)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=nodedotjs&logoColor=white)](#requirements)

</div>

---

Demo Video is a **free, open-source**, portable [Agent Skill](SKILL.md) that turns a website or desktop workflow into a polished MP4. Your coding agent writes a recording definition, records the flow through Playwright or native screen capture with a cursor that moves like a hand, narrates it with a local Kokoro voice, checks that narration with speech recognition, adds synchronized captions, and checks the encoded video for the evidence the narration promises. Everything runs on your machine, in an isolated runtime that never touches the project being demonstrated.

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
    - [Updates](#updates)
  - [Quick Start](#quick-start)
  - [Platform Coverage](#platform-coverage)
  - [Application Coverage](#application-coverage)
  - [Local Models](#local-models)
  - [Security](#security)
  - [Development \& Tests](#development--tests)
  - [Versioning \& Releases](#versioning--releases)
    - [Update signing key](#update-signing-key)
    - [Publishing a release](#publishing-a-release)
  - [Contributing](#contributing)
  - [Changelog](#changelog)
    - [v1.6.1 - November 2026 *(current)*](#v161---november-2026-current)
    - [v1.6.0 - November 2026](#v160---november-2026)
    - [v1.5.0 - October 2026](#v150---october-2026)
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
- 🗣️ **Local narration** - natural Kokoro voices (Piper as the second engine) run offline, cached per sentence, with pronunciation rules for product names
- 🖱️ **Human cursor** - curved, eased reaches timed like a hand, in browser and desktop recordings
- 👂 **Heard, not assumed** - speech recognition checks every narration line and the finished soundtrack against the script
- 💬 **Captions that match the speech** - phrase-level cues aligned to detected speech, in ASS and SRT
- ✅ **Proof, not hope** - DOM, OCR, and image checks confirm the encoded frames show what the narration says
- 🧪 **Isolated runtime** - browsers, models, and Python environments live under `~/.demo_video`, never in your project

---

## Features

- **Website recording** through Playwright with verified DOM selectors and state-aware actions: `check`, `uncheck`, `clickResponse`, `assert`, `if`, and `upload`
- **Native desktop recording** on Windows, Linux X11, and macOS, with coordinate, ratio, and image-based actions
- **Presentation stage** - a dark stage with window chrome, a large cursor, click ripples, controlled scrolls, and focus zooms, rendered at 2560x1440 for client demos
- **Human cursor motion** - curved arcs, minimum-jerk speed, Fitts-law timing, and a small overshoot on long reaches; drawn in the page for browser recordings (no move limit) and driven through the system pointer for desktop recordings, with human typing rhythm and a foreground-window guard
- **Kokoro narration** with the full-precision model and the `am_michael` voice by default, Piper as the second engine, automatic voice selection, tested pronunciation rules, per-step spoken overrides, audio mastering, and a cache that reuses unchanged clips
- **Narration verification** - faster-whisper transcribes every clip and the final soundtrack, compares the words with the captions, measures caption offsets, and lists heteronyms with their phonemes
- **Captions** generated from measured narration timing and aligned to speech with faster-whisper
- **Paired delivery** - clean MP4, captioned MP4, ASS, and SRT from one timeline that stays synchronized after cuts and speed changes
- **Fast revisions** - replace audio without re-recording, cut intervals, change speed, and patch a short section of a long H.264 video without a full re-encode
- **Evidence gates** - DOM evidence, OCR and reference-image checks on final frames, and optional semantic checks through a local Qwen3-VL endpoint
- **Quality checks** - blank and loading frame detection, single-frame flash detection, an optional deglitch pass for desktop captures, pacing analysis, whole-number silence compaction, lossless merging of split recordings, and stream checks on the final MP4
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
- Python 3.10 or newer for Kokoro, Piper, subtitle alignment, narration verification, OCR, desktop automation, or updates
- Internet access for the first model and browser download
- At least 4 GB of free cache space for models and caches; more when using local VLMs

### Updates

`bootstrap.mjs` checks once a day for a newer release and prints one line when there is one, naming the update command. Your agent passes that line on and updates only when you agree; the skill never updates itself. To update yourself:

```bash
node <installed-skill>/scripts/update-skill.mjs
```

The update downloads `release-manifest.json` and accepts it only when its signature matches a release public key built into the skill. It then checks the archive against the manifest's SHA-256, unpacks it into a new empty folder, and installs it into every supported skill folder that holds an older copy. Each folder keeps its newest `demo-video.backup-*` copy. Run `bootstrap.mjs` again from the updated skill afterward.

The check result is kept in `~/.demo_video/update-check.json`, and `doctor.mjs` reports it. A failed check stays silent and never stops bootstrap. Set `DEMO_VIDEO_NO_UPDATE_CHECK=1` to turn the check off.

---

## Quick Start

1. Bootstrap the isolated runtime and check what this PC supports:

   ```bash
   node <installed-skill>/scripts/bootstrap.mjs
   node ~/.demo_video/scripts/doctor.mjs
   ```

   Bootstrap stores runtimes, browser binaries, models, and caches under `~/.demo_video`. It does not modify the target application's dependencies. It is fast after the first run.

2. Ask your agent for a video. For example, in Codex:

   > Use $demo-video to create a clear tutorial of the sign-up flow at http://localhost:3000, with Kokoro narration, focused interactions, and captioned and clean versions.

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

- Kokoro v1.0 is the primary narration engine. Its full-precision model and voices (354 MB) download once, are checked against pinned SHA-256 digests, and remain cached; `kokoroPrecision` selects the smaller `fp16` or `int8` model.
- Piper is the second engine (`engine: "piper"`, default voice `en_US-ryan-medium`). Engine failures stop the render; another engine runs only when `fallbackEngine` names it.
- faster-whisper aligns captions to speech, scores voice pronunciation, and verifies narration (`large-v3-turbo` by default for verification).
- Qwen3-VL semantic evidence works through an OpenAI-compatible local endpoint. Set `DEMO_VLM_BASE_URL` and optionally `DEMO_VLM_MODEL`.

No remote semantic endpoint is contacted unless `quality.semanticEvidence` is configured.

---

## Security

- Keep credentials in environment variables, never in recording definitions.
- Treat recording definitions as executable UI automation and review them before running.
- Use dedicated test accounts and non-production data.
- Use local semantic endpoints for confidential screens.
- Review third-party model licenses before client use.
- Check release checksums before distribution. `update-skill.mjs` installs a release only after its signed manifest and archive checksum match.

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

Add `--with-kokoro` or `--with-piper` to the release test to run its narration checks with that engine instead of TinyTTS.

`bootstrap.mjs` syncs the scripts into `~/.demo_video`, so run it again after every edit before testing. The self-test covers the owned recorder with the human cursor, human path planning, conditional and response-bound actions, cached voice selection, narration pronunciation, audio mastering, pacing analysis, encoder selection, and GOP patching; add `--with-ocr` for OCR evidence or `--with-asr` for pronunciation scoring when the tiny faster-whisper model is cached. The release test checks paired delivery, whole-number silence compaction, flash detection, desktop path planning, signed update checks and a full update from a local release server, engine fallback rules, and narration revisions.

[CI](.github/workflows/ci.yml) runs these checks on Windows, Linux, and macOS for every push and pull request, plus the OCR evidence test on Windows. CI sets `DEMO_VIDEO_NO_UPDATE_CHECK=1`, so bootstrap never contacts the published releases there.

---

## Versioning & Releases

Demo Video follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. The version lives in one place, the [VERSION](VERSION) file. Releases are tagged `v<version>` and published as **Demo Video v\<version\>** with four files:

| File | Contents |
| --- | --- |
| `demo-video_<version>_skill.zip` | The skill in one `demo-video` folder, with fixed timestamps so the same source always gives the same zip |
| `demo-video_<version>_skill.zip.sha256` | The zip's SHA-256 checksum |
| `release-manifest.json` | Name, version, archive name, checksum, and file count |
| `release-manifest.json.sig` | ECDSA P-256 signature of the manifest, which installed copies check before offering an update |

Build the zip, checksum, and manifest locally with:

```bash
python scripts/package-skill.py . ./dist
```

### Update signing key

Every release manifest is signed with one ECDSA P-256 key that belongs to this repository. The private key lives in Doppler (project `demo-video`, config `prd`, secret `UPDATE_SIGNING_KEY`) and is copied from there to the repository's `UPDATE_SIGNING_KEY` Actions secret; its public half is in `UPDATE_PUBLIC_KEYS` in [scripts/lib/update-check.mjs](scripts/lib/update-check.mjs). Run these in WSL, where the Doppler and GitHub CLIs are signed in:

```bash
# Copy the key from Doppler to GitHub again (after replacing it, say)
doppler secrets get UPDATE_SIGNING_KEY -p demo-video -c prd --plain | gh secret set UPDATE_SIGNING_KEY --repo ShahFaisalGfG/demo-video
# Print the public half, the form `UPDATE_PUBLIC_KEYS` in [scripts/lib/update-check.mjs](scripts/lib/update-check.mjs) holds
doppler secrets get UPDATE_SIGNING_KEY -p demo-video -c prd --plain | openssl ec -pubout
# Sign a local build with it
doppler run -p demo-video -c prd -- python3 scripts/sign_update.py dist/release-manifest.json --expect scripts/lib/update-check.mjs
```

To replace the key, store a new one in Doppler, release one version signed with the old key whose list holds both public keys, then copy the new key to GitHub. If the key were lost, installed copies could no longer verify updates. Doppler keeps it, with its version history; never commit it or leave a copy in a file.

`scripts/sign_update.py` signs a file the same way the gfgRoyal desktop apps sign theirs, and needs the `cryptography` package. `--expect` stops it when the key's public half is not in the named source file.

### Publishing a release

To release a version:

1. Update [VERSION](VERSION) and write `release_notes/release_notes_v<version>.md`.
2. Add the version to the [Changelog](#changelog) below.
3. Tag the release commit and push the tag:

   ```bash
   git tag v1.5.0
   git push origin v1.5.0
   ```

The [Build and Release](.github/workflows/build-release.yml) workflow checks that the tag matches `VERSION` and that the release notes exist, runs the full CI suite, packages the skill, signs the manifest, and publishes the GitHub release. It stops before publishing when the `UPDATE_SIGNING_KEY` secret is missing, or when no key in `UPDATE_PUBLIC_KEYS` verifies the new signature. Re-running it, or pushing the tag again, replaces the files of the existing release.

---

## Contributing

Contributions are welcome - bug reports, fixes, new capture sources, voices, or a clearer sentence in the docs.

1. **Fork** the repository and clone your fork
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and run the checks in [Development & Tests](#development--tests)
4. Commit with a clear message and open a **Pull Request** targeting `main`

Keep credentials, client recordings, and generated media out of commits. For significant changes, please [open an issue](https://github.com/ShahFaisalGfG/demo-video/issues) first to discuss the approach.

---

## Changelog

### v1.6.1 - November 2026 *(current)*
- 🔔 **Update notices** - bootstrap checks once a day for a newer release and prints one line naming the update command
- 🔏 **Signed updates** - `update-skill.mjs` installs a release only when its manifest signature and archive checksum match, after you agree
- 🗂️ **Every installed copy updated** across Claude Code, Codex, Cursor, and the shared skill folder, keeping the newest backup of each
- 🩺 **Update status** in `doctor.mjs`, and `DEMO_VIDEO_NO_UPDATE_CHECK=1` to turn the check off

### v1.6.0 - November 2026
- 🗣️ **Kokoro narration by default** with the full-precision model and the `am_michael` voice; Piper is the second engine
- 🖱️ **Human cursor motion** in browser and desktop recordings, with no cursor move limit in the browser
- 👂 **Narration verification** with speech recognition, caption offsets, and heteronym phonemes
- 🔤 **Tested pronunciation rules** - plain capitals, hyphenated letters, audible plurals, and per-step `spokenNarration`
- 🎞️ **Flash detection** in final QA, an optional desktop deglitch pass, and whole-number silence compaction
- 🛡️ **Safer captures** - a foreground-window guard for desktop input, and refusal of recordings whose post-processing failed

### v1.5.0 - October 2026
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

Built with Playwright, testreel, FFmpeg, Kokoro, Piper, faster-whisper, RapidOCR, and PyAutoGUI.

Built with ❤️ by **Shah Faisal** · [Portfolio](https://shahfaisalgfg.github.io/) · [shahfaisalgfg@gmail.com](mailto:shahfaisalgfg@gmail.com)

---

## Support the Project

Demo Video is free and will always stay free. If it saved you an afternoon of recording and editing, here are a few ways to give back:

- ⭐ **Star the repo** - it helps others find the project
- 🐛 **Report a bug** - a flow that won't record is worth an issue
- 💡 **Suggest a feature** - a new capture source, voice, or delivery format
- 🔁 **Share it** - tell a friend or a team that ships demos
- 🛠️ **Contribute code** - see [Contributing](#contributing)

**[★ Star Demo Video on GitHub](https://github.com/ShahFaisalGfG/demo-video)**

---

*Show it. Say it. Prove it.* 🎬
