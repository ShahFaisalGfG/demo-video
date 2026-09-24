# Demo Video Agent Skill

Portable Agent Skill for narrated and silent product demonstrations. It records websites through Playwright, records supported native desktop applications through FFmpeg and PyAutoGUI, generates and scores local narration, produces closed captions, and verifies final video evidence.

Version 1.5.0 adds tutorial direction for demos, how-to guides, and training, cached Piper narration with working speed control, stale-audio detection, offline capture reuse, and paired video delivery with synchronized ASS/SRT captions. Piper remains the default; fallback requires explicit configuration.

For a new guide, follow [tutorial direction](references/tutorials.md). For final files or revisions, use the [delivery workflow](references/delivery.md). The delivery command can replace audio without re-recording, remove specified intervals, change speed, and produce clean and subtitled MP4 files from one timeline.

## Supported agents

The package follows the Agent Skills `SKILL.md` format and can be installed for:

- Codex: `~/.codex/skills/demo-video`
- Claude Code: `~/.claude/skills/demo-video`
- Cursor: `~/.cursor/skills/demo-video`
- Shared Agent Skills location: `~/.agents/skills/demo-video`

Install into every supported user directory:

```bash
node scripts/install-skill.mjs --host all
```

Use `--host codex`, `claude`, `cursor`, or `agents` for one target. Existing installations are preserved unless `--force` is supplied.

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer for Piper, subtitle alignment, OCR, or desktop automation
- Internet access on the first model and browser installation
- At least 2 GB of free cache space; more when using local VLMs

Bootstrap after installation:

```bash
node <installed-skill>/scripts/bootstrap.mjs
node ~/.demo_video/scripts/doctor.mjs
```

Bootstrap stores runtimes, browser binaries, models, and caches under `~/.demo_video`. It does not modify the target application's dependencies.

## Platform coverage

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

## Application coverage

- Websites and browser applications use verified DOM selectors and receive the strongest automation and evidence checks.
- Electron, Tauri, and embedded-WebView applications should expose a development or remote-debug URL when possible, allowing the website recorder to use DOM selectors.
- Native Windows, Linux X11, and macOS applications use the desktop recording definition in `template.desktop-recording.json`.
- Mobile applications can be demonstrated through a desktop mirror, emulator, or supplied silent capture.
- Applications protected against capture or automation require a user-supplied recording.

## Local models

- Piper is the primary narration engine. The default `en_US-ryan-medium` voice downloads once and remains cached.
- Qwen3-VL semantic evidence works through an OpenAI-compatible local endpoint. Set `DEMO_VLM_BASE_URL` and optionally `DEMO_VLM_MODEL`.

No remote semantic endpoint is contacted unless `quality.semanticEvidence` is configured.

## Release package

Create a deterministic zip, checksum, and release manifest:

```bash
python scripts/package-skill.py . ./dist
```

The zip contains one top-level `demo-video` folder and can be copied into any supported skill directory or uploaded to a skill service that accepts zip archives.

## Security

- Keep credentials in environment variables, never recording definitions.
- Review third-party model licenses before client use.
- Treat recording definitions as executable UI automation.
- Use local semantic endpoints for confidential screens.
- Inspect release checksums before distribution.

See [SKILL.md](SKILL.md) for the agent workflow and [reference.md](reference.md) for schemas and advanced options.
