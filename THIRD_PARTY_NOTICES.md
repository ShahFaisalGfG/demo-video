# Third-party notices

This skill downloads or invokes optional third-party components. They are not bundled in the release archive unless their own files already appear in the skill directory.

| Component | Purpose | License / notice |
|---|---|---|
| Playwright | Browser automation | Apache-2.0 |
| testreel | Cursor animation and video post-processing | MIT |
| FFmpeg static npm build | Media encoding and inspection | GPL-3.0-or-later in the currently tested package |
| Kokoro-82M v1.0 model and voices | Default speech synthesis | Apache-2.0 |
| kokoro-onnx | Kokoro ONNX runtime wrapper | MIT |
| espeak-ng (through espeakng-loader and phonemizer) | Phonemization for Kokoro | GPL-3.0 (espeak-ng); phonemizer GPL-3.0 |
| soundfile | Writing narration WAV files | BSD-3-Clause |
| Piper maintained fork | Second speech synthesis engine | GPL-3.0; individual voice-data licenses vary |
| faster-whisper | Speech alignment, voice scoring, and narration verification | MIT |
| Whisper model weights | Optional speech recognition | Review selected model card |
| RapidOCR / ONNX Runtime | OCR evidence | Apache-2.0 / MIT components; review package notices |
| PyAutoGUI | Native desktop automation | BSD-3-Clause |
| OpenCV (headless) and NumPy | Image matching and desktop deglitching | Apache-2.0 / BSD-3-Clause |
| Qwen3-VL model weights | Optional semantic evidence | Apache-2.0 for the recommended 2B and 4B repositories |
| TinyTTS | Emergency local narration fallback | Apache-2.0 |

Before distributing client deliverables, review the model card for every selected voice and model. A tool license and its generated media license are separate questions.
