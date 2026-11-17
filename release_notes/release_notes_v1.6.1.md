# Demo Video v1.6.1 - Release Notes

**Released:** November 2026 · **Status:** Stable · **Platform:** Windows, Linux and macOS · **Agents:** Claude Code, Codex, Cursor and other Agent Skills hosts

---

Demo Video is an Agent Skill that turns a website or desktop workflow into a polished, narrated MP4 with synchronized captions, and proves that the final video shows what the narration promises. v1.6.1 keeps the skill current: bootstrap tells you when a newer release is out, and one command installs it into every agent that has the skill, after checking that the release came from this project and arrived intact. Nothing updates without your agreement.

---

## Breaking Changes

None for recording definitions. Releases now include `release-manifest.json.sig`, and the release workflow stops when the signing key is missing.

---

## Added

- **Update notices.** `bootstrap.mjs` checks once a day for a newer release and prints one line naming the update command. The check has a 5-second limit, stays silent when the network fails, and never stops bootstrap. The result is kept in `~/.demo_video/update-check.json`.
- **Signed updates.** `update-skill.mjs` downloads the latest release manifest and accepts it only when its ECDSA P-256 signature matches a public key built into the skill. It then checks the archive against the manifest's SHA-256 and unpacks it into a new empty folder before anything is replaced.
- **Every installed copy updated.** The update replaces each older copy in the Claude Code, Codex, Cursor, and shared Agent Skills folders, and keeps only the newest `demo-video.backup-*` copy in each folder.
- **Agent guidance.** `SKILL.md` tells the agent to pass the update notice on, run the update only when you agree, and never during a recording or render.
- **Update status** in `doctor.mjs`.
- **`DEMO_VIDEO_NO_UPDATE_CHECK=1`** turns the daily check off. CI sets it.

## Changed

- The release workflow signs `release-manifest.json` with `scripts/sign_update.py`, the signing script the gfgRoyal desktop apps share, and publishes `release-manifest.json.sig` with the release. It stops when the `UPDATE_SIGNING_KEY` secret is missing or when no key the skill ships verifies the signature.
- Kokoro model downloads and skill updates share one verified download helper (`scripts/lib/download.mjs`).
- `install-skill.mjs` and `update-skill.mjs` share one list of agent skill folders (`scripts/lib/skill-hosts.mjs`).
- `package-skill.py` removes a stale `release-manifest.json.sig` when it writes a new manifest.

---

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer for Kokoro, Piper, subtitle alignment, narration verification, OCR, desktop automation, or updates
- Internet access for the first browser and model download, and for update checks
- At least 4 GB of free cache space; more when using local VLMs

---

## Installing

1. Download `demo-video_1.6.1_skill.zip` below and check it against `demo-video_1.6.1_skill.zip.sha256`.
2. Unzip it and run `node demo-video/scripts/install-skill.mjs --host all --force` to replace an earlier installation (the previous copy is kept as a backup), or copy the `demo-video` folder into one skill directory yourself.
3. Run `node <installed-skill>/scripts/bootstrap.mjs`, then `node ~/.demo_video/scripts/doctor.mjs` to check what this PC supports.

Later releases install with `node <installed-skill>/scripts/update-skill.mjs`.

---

*Show it. Say it. Prove it.* 🎬
