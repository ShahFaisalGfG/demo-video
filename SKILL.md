---
name: demo-video
description: "Create and revise narrated product demos, how-to tutorials, and step-by-step video guides for websites and desktop apps. Uses Kokoro narration (Piper as the second engine), human-like cursor motion, framed screen capture, focus zooms, synchronized ASS/SRT captions, speech-checked audio, and fast edits to existing videos."
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

Browser recordings move the cursor like a hand by default (`cursor.motion: "human"`): curved, eased reaches whose length sets their duration, a small overshoot on long reaches, and a ripple on every click. The cursor is drawn in the page, so a recording has no limit on cursor moves. `cursor.motion: "linear"` keeps testreel's straight composited cursor, which supports at most 48 moves per recording; the recorder refuses more instead of losing the cursor, frame, and background.

For native desktop capture, the runner moves the system pointer the same way and types with a varied rhythm (`capture.motion: "human"`). Set `capture.windowTitle` to part of the application's window title; on Windows, input stops the moment another window takes the foreground, such as a notification or chat popup. Before a desktop take, ask the user to turn on Do Not Disturb, close chat and mail apps, and keep hands off the mouse and keyboard until the take ends. Set `quality.deglitch: true` to replace repaint flashes and frames that jump away and return within twelve frames (0.4 seconds at 30 fps); it also hides an intended change that short, so review the result.

Keep route changes at clip boundaries when a page mounts through a blank shell. Split long workflows into `__partN` recordings and merge them afterward. Use `framingSelectors` on narrated steps so the verifier can reject clipped or below-fold content.

Use `authRefresh` with environment-provided credentials for expiring sessions. Never place credentials in the recording file.

## Presentation direction

Build a clear tutorial around the viewer's intended outcome:

- Start from a 1920x1080 browser viewport and render client-facing browser demos at 2560x1440 unless the user requests another format.
- Place the product inside a dark presentation stage with 32 pixels of padding, a 16-pixel corner radius, visible window chrome, and a descriptive title instead of a raw URL.
- Use a large pointer cursor with human motion, visible click ripples, controlled scrolls, and short holds so viewers can follow every interaction.
- Zoom to roughly 1.3x to 1.5x around the control or result being explained, then return to 1x before moving to another section.
- Use highlights, overlays, or supporting visualizations only when they clarify the workflow. Keep them visually consistent with the product.
- Prefer several focused clips over one long capture. Put route changes, major modal transitions, and slow data loads at clip boundaries.
- Remove loading screens, dead time, and long silent holds. Let the narration lead each action and keep the resulting state visible long enough to understand it.
- Speed up dead time only by whole numbers (2x, 3x, or 4x). Fractional speed-ups drop frames unevenly and make cursor motion stutter.
- Use `libx264` for deterministic final quality. Use hardware encoding only when a comparison confirms that it preserves text, borders, gradients, and cursor detail.

The starter browser definition contains this QHD stage treatment and an example zoom. Adapt the style to the product and requested reference. Output resolution alone cannot improve detail missing from the capture.

## Narration quality

Write narration for speech, not as documentation:

- Use one idea per sentence and usually no more than 28 words.
- Write continuous, conversational narration that says what each step is doing as it starts. Short caption-style lines separated by silence sound like a voice that waits, then blurts a few words without context.
- Prefer direct verbs and short transitions.
- Avoid dense parentheticals, long lists, and unexplained acronyms.
- Read product names, abbreviations, numbers, and dates aloud before rendering.

The pipeline preserves `narration` as the caption text while synthesizing a separate speech-friendly form. Add project vocabulary through `narrationConfig.pronunciations` or `pronunciationFile`. Set `strictNarration: true` for production work so long sentences and unknown acronyms stop the render.

Both engines read plain capitals letter by letter, so map a spelled abbreviation to itself (`"SPF": "SPF"`). Never spell letters with spaces or as words: "A P I" is read as "a P I" and "ay pee eye" as "eye pee eye". Use hyphenated letters (`"AWS": "A-W-S"`) for the few abbreviations read as words. Plurals such as "IDs" are spelled automatically ("I-Dees") so the s stays audible. For words spelled alike but said differently, set `spokenNarration` on the step: the caption keeps `narration` and the voice speaks the override, for example past-tense "read" written as "red".

Audio mastering is enabled by default. It applies speech-band filtering, compression, loudness normalization, and limiting. Keep it enabled unless a supplied voice track is already mastered. Kokoro v1.0 is the primary engine, with the US English male voice `am_michael` and the full-precision model; `kokoroVoice`, `kokoroPrecision` (`fp32`, `fp16`, `int8`), and `kokoroLang` change them. Piper is the second engine: use `engine: "piper"` with `piperVoice: "en_US-ryan-medium"` when the user asks for Piper or Kokoro is unavailable. Review the selected voice model card before client delivery.

For automatic voice choice, provide two or more `voiceCandidates`. The selector synthesizes one short calibration passage per candidate, scores it, caches the winner, and generates the full narration once. Use `voiceSelection.mode: "cached-asr"` to add pronunciation scoring when the existing faster-whisper cache is available without downloading anything during the render. Use `"verified"` only when first-run model setup time is acceptable.

Engine failures stop by default; a voice change requires an explicit `fallbackEngine` (`"piper"` or `"tiny-tts"`), and narration within one recording definition that mixes voices because a fallback ran for only some clips stops the render; keep every `__partN` definition on the same engine and voice. Unchanged narration clips are cached by spoken text and voice settings. `cacheNarration: false` forces fresh clips. For a named presenter, address the viewer directly in that presenter's voice.

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

The compiler checks narration freshness, trims startup loading, rejects long blank intervals, and refuses a capture whose cursor, frame, or speed post-processing failed. The browser starter selects `libx264`; existing definitions can still request automatic hardware selection.

Check the narration with speech recognition before delivery. The verifier transcribes every clip with faster-whisper `large-v3-turbo`, compares the words with the captions, and lists words such as "read", "record", and "live" with their phonemes so tense and stress can be reviewed. With the final video it also checks the whole soundtrack in order and each caption's start:

```bash
node ~/.demo_video/scripts/verify-narration.mjs demo/<name>.recording.json
node ~/.demo_video/scripts/verify-narration.mjs demo/<name>__part1.recording.json demo/<name>__part2.recording.json \
  --video demo/output/<name>.mp4 --srt demo/output/<name>.srt
```

Fix every reported difference in the pronunciation dictionary or `spokenNarration`, synthesize again, and rerun the check. Add `narrationConfig.asrEquivalents` only for spellings the recognizer writes differently from the caption, such as `{ "limited-use": "Limited Use" }`.

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
3. Confirm narration is clear, correctly pronounced, and synchronized: run `verify-narration.mjs` on the clips and on the final soundtrack, and listen to the opening and every edited line.
4. Confirm captions use one or two short lines and match speech timing.
5. Run OCR or reference-image checks for claims that must appear in the encoded frames.
6. Probe the final MP4 for H.264 video, AAC audio, and matching stream durations.
7. Run `verify-video.mjs` and inspect representative frames, including submission results and error-toast regions. It fails on single-frame flashes and lists frames that jump away and return; review each one, or pass `--strict` to fail on them.
8. Keep the video within any length the user set; speed up dead time at whole-number rates rather than fractional ones.
9. Run `doctor.mjs` on the delivery host when the video depends on native capture, hardware encoding, or optional local models.

When changing this skill, run:

```bash
node ~/.demo_video/scripts/self-test.mjs --with-ocr
node ~/.demo_video/scripts/release-test.mjs
```

The self-test covers the owned recorder with the human cursor, the linear cursor limit, human path planning, conditional and response-bound actions, cached voice selection, narration pronunciation and spoken overrides, the narration comparison rule, audio mastering, pacing analysis, encoder selection, GOP patching, OCR evidence, and a mocked semantic endpoint. Add `--with-asr` to test pronunciation scoring when the tiny faster-whisper model is already cached. The release test uses TinyTTS; add `--with-kokoro` or `--with-piper` to run its narration checks with that engine. The bundled CI workflow runs the core suite on Windows, macOS, and Linux.
