# Delivery and focused revisions

Run `node <runtime>/scripts/deliver-video.mjs <delivery.json>` after the clean master and aligned captions are ready. The script uses local FFmpeg; it never opens the website or repeats recorded actions.

```json
{
  "source": "output/tutorial-master.mp4",
  "captions": "output/tutorial-aligned.srt",
  "outputPrefix": "output/tutorial-final",
  "speed": 1,
  "cuts": [],
  "burnCaptions": true,
  "captionStyle": {
    "font": "Arial",
    "position": "bottom"
  }
}
```

Paths resolve relative to the JSON file. The source must be H.264 without burned captions. Use a fresh output prefix per revision; the script refuses to overwrite existing outputs or its inputs. It stages processing in a temporary directory and publishes files after encoding finishes.

With captions, the outputs are `<prefix>.mp4`, `<prefix>_subtitled.mp4`, `<prefix>.ass`, `<prefix>.srt`, and `<prefix>.delivery.json`. Without captions, it produces the clean MP4 and delivery report. `burnCaptions: false` produces sidecars without the burned version.

ASS captions use white bold text with an opaque black box. Font size defaults to 3.5% of video height, with 6% safe margins. `captionStyle.fontSize` and `captionStyle.margin` accept pixels in source-video coordinates. `position` accepts `top` or `bottom`. A selected font must be installed on the delivery machine; inspect the rendered result for font substitutions.

## Speed and silent cuts

```json
{
  "source": "output/tutorial-master.mp4",
  "captions": "output/tutorial-aligned.srt",
  "outputPrefix": "output/tutorial-shorter",
  "speed": 1.25,
  "cuts": [[25, 32], [83, 88]]
}
```

All cut times are seconds in the supplied source, before speed adjustment. Do not mix times from earlier versions. Overlapping removal intervals are merged. Retained video, audio, and subtitles use the same time map. Audio speed changes preserve pitch. Supported delivery speeds range from 0.5x to 2x.

A cut intersecting a caption fails by default. Prefer measured silent boundaries. `allowCutSpeech: true` permits deliberate removal but does not rewrite the words in a partially cut caption; edit or regenerate those captions before delivery. Without an SRT, the script cannot protect spoken content automatically. Confirm silent boundaries by listening or using a silence detector before cutting.

The report records the source, retained intervals, speed, resulting duration, and cues above 22 visible characters per second. It supports traceable revisions; it does not replace visual or listening review.

## Replace narration without recording again

Add `"audio": "output/replacement-track.wav"` to the delivery specification. It must already align with the source master and have a matching duration within 0.25 seconds. Supply SRT captions aligned to this replacement narration. The tool does not stretch a mismatched voice track to fit or infer synchronization from duration.

At 1x with no cuts, the clean video's H.264 stream is copied without re-encoding, including when replacing audio. Replacement audio and source audio in other codecs are encoded as AAC at 192 kbps; existing AAC is copied. If the replacement has no captions, set `burnCaptions: false` and omit `captions`.

Timing edits use H.264 CRF 18 and AAC 192 kbps. Burning captions uses the clean output and copies its audio. Keep the original master to avoid repeatedly encoding edited copies. Short caption or highlight changes should use the existing patch helpers when they can preserve more of the original video.

## Offline capture reuse

`compile-video.mjs <definition> --reuse-video <verified-silent-capture>` skips login refresh and website availability checks. The narration manifest must match the current definition; regenerate narration after editing its text. Capture reuse preserves the visual timeline, so a changed sentence must fit its scene or the scene timing must be revised. It does not automatically retime the screen recording.

## Narration controls

Piper uses `en_US-ryan-medium` by default. `narrationConfig.speed` now changes Piper phoneme duration. Values above 1 speak faster; leave it at 1 unless a different rate is wanted. Clip durations are measured after synthesis.

Piper failures stop by default to keep voice choice consistent. `fallbackEngine: "tiny-tts"` explicitly permits emergency fallback; `null` keeps Piper required. Fallback clips are recorded with their engine in the manifest and are not cached as Piper clips. `cacheNarration: false` forces fresh synthesis when replacing a model file or investigating sound quality.

Unchanged speech clips are reused across recording parts in the same project. The cache key includes spoken text, engine, voice, speaker, speed, and explicit model identity. Updated narration invalidates the compile manifest, preventing the final video from using stale audio by accident.
