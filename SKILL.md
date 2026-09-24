---
name: demo-video
description: "Create and revise narrated product demos, how-to tutorials, and step-by-step video guides for websites and desktop apps. Uses Piper narration, framed screen capture, focus zooms, synchronized ASS/SRT captions, and fast edits to existing videos."
---

# Demo video

Create a polished MP4 that shows a complete website or desktop workflow, keeps the relevant UI in frame, speaks concise narration, and proves that the encoded result contains the promised evidence.

The user's instructions take precedence over this workflow. This skill does not grant permission to modify an application, expose credentials, spend provider credits, or mutate a shared environment beyond the user's request.

Read [reference.md](reference.md) when the task needs detailed schemas, authentication refresh, evidence formats, subtitle alignment, patching, or troubleshooting.

Read [references/tutorials.md](references/tutorials.md) for new demos, how-to guides, and training videos. Read [references/delivery.md](references/delivery.md) for paired video exports, ASS captions, audio replacement, speed changes, or silent cuts. Use the existing user brief to make routine choices without repeating questions.

## Prepare the flow

1. Confirm the target environment, user journey, deliverables, resolution, and voice requirements.
2. Inspect the rendered DOM or use Playwright codegen to obtain verified selectors. Do not invent selectors.
3. Check required reference data before recording. Empty dropdowns and disabled submissions often indicate missing data rather than recorder failure.
4. Prefer a production build when available. Restart and warm a development server before a large render batch.
5. Prototype multi-field submissions with Playwright before writing the recording definition. Confirm that the submit control becomes enabled and that the expected response and page state follow.

Do not modify application source solely to make a flow recordable. Ask the user when the requested screen depends on an unavailable product capability.

## Bootstrap the isolated runtime

Run the bundled bootstrap from this skill directory before each task. It is fast after the first run and keeps all dependencies under `~/.demo_video`.

```bash
node <skill-dir>/scripts/bootstrap.mjs
node ~/.demo_video/scripts/doctor.mjs
```

Do not install recorder, browser, speech, OCR, or FFmpeg dependencies into the target project.

## Write the recording definition

Start from [template.recording.json](template.recording.json). The owned recorder adapter is the default and does not modify testreel package files.

For native applications, start from [template.desktop-recording.json](template.desktop-recording.json). Prefer a browser or remote-debug URL for Electron, Tauri, or WebView applications because DOM selectors are more stable than coordinates and screenshots. Native desktop definitions support Windows, Linux X11, and macOS screen capture with coordinate or reference-image actions. Read [README.md](README.md) for platform permissions and limitations.

Use these actions when state matters:

- `check` and `uncheck` for deterministic checkbox state.
- `clickResponse` to register a response listener before the click and validate method and status.
- `assert` for text, count, visibility, enabled state, checked state, or input value.
- `if` for nested state-dependent action lists.
- `upload` with `visualSelector` to show the visible file control while attaching files through the browser input.

Keep route changes at clip boundaries when a page mounts through a blank shell. Split long workflows into `__partN` recordings and merge them afterward. Use `framingSelectors` on narrated steps so the verifier can reject clipped or below-fold content.

Use `authRefresh` with environment-provided credentials for expiring sessions. Never place credentials in the recording file.

## Presentation direction

Build a clear tutorial around the viewer's intended outcome:

- Start from a 1920x1080 browser viewport and render client-facing browser demos at 2560x1440 unless the user requests another format.
- Place the product inside a dark presentation stage with 32 pixels of padding, a 16-pixel corner radius, visible window chrome, and a descriptive title instead of a raw URL.
- Use a large pointer cursor, visible click ripples, controlled scrolls, and short holds so viewers can follow every interaction.
- Zoom to roughly 1.3x to 1.5x around the control or result being explained, then return to 1x before moving to another section.
- Use highlights, overlays, or supporting visualizations only when they clarify the workflow. Keep them visually consistent with the product.
- Prefer several focused clips over one long capture. Put route changes, major modal transitions, and slow data loads at clip boundaries.
- Remove loading screens, dead time, and long silent holds. Let the narration lead each action and keep the resulting state visible long enough to understand it.
- Use `libx264` for deterministic final quality. Use hardware encoding only when a comparison confirms that it preserves text, borders, gradients, and cursor detail.

The starter browser definition contains this QHD stage treatment and an example zoom. Adapt the style to the product and requested reference. Output resolution alone cannot improve detail missing from the capture.

## Narration quality

Write narration for speech, not as documentation:

- Use one idea per sentence and usually no more than 28 words.
- Prefer direct verbs and short transitions.
- Avoid dense parentheticals, long lists, and unexplained acronyms.
- Read product names, abbreviations, numbers, and dates aloud before rendering.

The pipeline preserves `narration` as the caption text while synthesizing a separate speech-friendly form. Add project vocabulary through `narrationConfig.pronunciations` or `pronunciationFile`. Set `strictNarration: true` for production work so long sentences and unknown acronyms stop the render.

Audio mastering is enabled by default. It applies speech-band filtering, compression, loudness normalization, and limiting. Keep it enabled unless a supplied voice track is already mastered. Piper is the primary engine. Use `engine: "piper"` with `piperVoice: "en_US-ryan-medium"` for the established neutral US male narration, and review the selected voice model card before client delivery.

For automatic voice choice, provide two or more `voiceCandidates`. The selector synthesizes one short calibration passage per candidate, scores it, caches the winner, and generates the full narration once. Use `voiceSelection.mode: "cached-asr"` to add pronunciation scoring when the existing faster-whisper cache is available without downloading anything during the render. Use `"verified"` only when first-run model setup time is acceptable.

Piper failures stop by default; an engine change requires an explicit `fallbackEngine: "tiny-tts"` configuration. Unchanged narration clips are cached by spoken text and voice settings. `cacheNarration: false` forces fresh clips. For a named presenter, address the viewer directly in that presenter's voice.

## Verify and render

Run the structural verifier before synthesis:

```bash
DEMO_BASE_URL=<url> node ~/.demo_video/scripts/verify-steps.mjs demo/<name>.recording.json
```

Add root `evidence` entries for DOM state and set `quality.requireEvidence: true` when proof is required. Add `quality.visualEvidence` for final-frame OCR or reference-image comparison. The compiler refuses missing, stale, or failed evidence.

Add `quality.semanticEvidence` only when a storyboard claim requires interpretation beyond OCR or image similarity. Point `DEMO_VLM_BASE_URL` at a local OpenAI-compatible Qwen3-VL endpoint. Semantic evidence is opt-in because it is slower and may transmit screenshots to the configured endpoint.

Render a narrated video:

```bash
DEMO_BASE_URL=<url> node ~/.demo_video/scripts/generate-narration.mjs demo/<name>.recording.json
DEMO_BASE_URL=<url> node ~/.demo_video/scripts/compile-video.mjs demo/<name>.recording.json
```

Render a silent walkthrough with the same owned adapter:

```bash
DEMO_BASE_URL=<url> node ~/.demo_video/scripts/record-video.mjs demo/<name>.recording.json demo/output
```

The compiler checks narration freshness, trims startup loading, and rejects long blank intervals. The browser starter selects `libx264`; existing definitions can still request automatic hardware selection.

## Merge, captions, and timing

Merge compatible internal parts without re-encoding:

```bash
node ~/.demo_video/scripts/merge-videos.mjs demo/output/<name>.mp4 \
  demo/output/<name>__part1.mp4 demo/output/<name>__part2.mp4
```

Generate captions from measured narration timing, then align them to detected speech when precision matters:

```bash
node ~/.demo_video/scripts/generate-subtitles.mjs demo/output/<name>.srt \
  demo/<name>__part1.recording.json demo/<name>__part2.recording.json

node ~/.demo_video/scripts/align-subtitles.mjs \
  demo/output/<name>.mp4 demo/output/<name>-aligned.srt \
  --source-srt demo/output/<name>.srt --model tiny.en
```

Closed captions must appear when spoken, use short phrase-level cues, and occupy no more than two lines. Use `reflow-subtitles.mjs` only when speech alignment is unavailable.

Export the clean video, burned version, white bold ASS captions on black boxes, and SRT together:

```bash
node ~/.demo_video/scripts/deliver-video.mjs demo/delivery.json
```

The [delivery reference](references/delivery.md) provides the configuration. One source-time edit map keeps all variants synchronized after cuts and speed changes. Use a fresh output prefix for each revision.

Compact silent gaps without speeding narration:

```bash
node ~/.demo_video/scripts/compact-silence.mjs \
  demo/output/<name>.mp4 demo/output/<name>.srt \
  demo/output/<name>-compact.mp4 demo/output/<name>-compact.srt \
  --silence-speed 4 --minimum-gap-ms 500
```

Run pacing analysis once on the final merged video and final SRT. It samples one small frame per second and does not re-encode the video:

```bash
node ~/.demo_video/scripts/analyze-pacing.mjs \
  demo/output/<name>.mp4 demo/output/<name>.srt \
  demo/output/<name>-pacing.json
```

Review long silent holds, rushed captions, repeated screens, rapid cuts, and cuts that land mid-sentence. Keep pacing analysis out of intermediate renders unless `quality.pacingAnalysis: true` is explicitly useful.

## Focused video corrections

Apply several overlays in one full encode with `patch-video.mjs`.

For a short correction in a long H.264 video, use GOP-window patching. It stream-copies unaffected keyframe intervals and encodes only the repair windows:

```bash
node ~/.demo_video/scripts/patch-video-gop.mjs \
  demo/output/<name>.mp4 patches.json demo/output/<name>-patched.mp4 auto
```

Use the full-pass patcher for non-H.264 input, corrections spanning most of the timeline, or output that must be codec-normalized.

## Final quality gate

Before delivery:

1. Confirm every requested action and result is visible.
2. Confirm no page transition leaves a long blank frame.
3. Confirm narration is clear, correctly pronounced, and synchronized.
4. Confirm captions use one or two short lines and match speech timing.
5. Run OCR or reference-image checks for claims that must appear in the encoded frames.
6. Probe the final MP4 for H.264 video, AAC audio, and matching stream durations.
7. Run `verify-video.mjs` and inspect representative frames, including submission results and error-toast regions.
8. Run `doctor.mjs` on the delivery host when the video depends on native capture, hardware encoding, or optional local models.

When changing this skill, run:

```bash
node ~/.demo_video/scripts/self-test.mjs --with-ocr
node ~/.demo_video/scripts/release-test.mjs
```

The self-test covers the owned recorder, conditional and response-bound actions, cached voice selection, narration pronunciation, audio mastering, pacing analysis, encoder selection, GOP patching, OCR evidence, and a mocked semantic endpoint. Add `--with-asr` to test pronunciation scoring when the tiny faster-whisper model is already cached. The bundled CI workflow runs the core suite on Windows, macOS, and Linux.
