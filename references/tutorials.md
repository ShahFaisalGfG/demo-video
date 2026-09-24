# Tutorial direction

Use this reference when creating a new how-to, onboarding guide, product demonstration, or training video. Infer the audience and format from the request. Ask only for choices that affect the result and remain unknown.

## Choose the teaching style

| Request | Story shape | Useful default |
|---|---|---|
| Short product demo | Outcome, representative workflow, visible result | About 60 to 120 seconds when the user gives no duration |
| How-to tutorial | Starting state, numbered actions, result, next step | Pace for a first-time viewer; show every essential action |
| Training guide | Prerequisites, chapters, complete workflows, recovery tips | Separate clips per chapter; explain decisions where they occur |
| Narration or caption revision | Existing master plus requested replacement | Reuse capture; change only the required media tracks or intervals |

Do not force a complete instructional workflow into a short promotional duration. Estimate speech at roughly 130 to 155 words per minute plus necessary visual holds, then use measured Piper audio to establish timing. The estimate is planning guidance, not a fixed playback rate.

## Storyboard before recording

Use a compact table in the working notes with columns for: scene, viewer goal, visible action, expected result, narration, focus area, and whether the action changes application data. Assign each scene a stable name and its own recording part where practical.

Start with the viewer's desired outcome and any required workspace or account switch. Keep login credentials outside the capture. Show the route into the feature, then the full action and its result. End with the next useful action or an invitation to try the workflow. Avoid repeated introductions, unnecessary menu tours, and an empty closing screen.

For a named presenter, write in their voice: "I'll show you how to..." and "You can now...". For an unnamed tutorial, address the viewer as "you". Do not narrate the agent's work, describe the viewer in the third person, or insert unverified claims about automatic behavior.

## Visual treatment

The QHD dark stage in `template.recording.json` is a starting style. Match the product and any user-supplied reference. A light application may still use a dark border; a supplied brand palette can replace it. Keep fonts, cursor, titles, accent color, and framing consistent across clips.

QHD output does not create detail missing from the capture. Choose a source viewport where controls are legible, retain its aspect ratio, and inspect text at delivery size. For native apps, fix the window and display scale before capture. Do not crop away the navigation that explains how to reach a feature.

Use focus zooms around 1.3x to 1.5x for small controls. Confirm the complete target and required context remain visible. Return to a wide view for navigation. A highlight should point to the next action or its result, then disappear. Avoid constant zoom motion or decorations over text.

For typing tutorials, show visible entry using `type` and a deliberate delay when the content matters. Use `fill` for incidental long values. Introduce keyboard shortcuts before they execute; use a small key label or narration where the keypress has no visible cue. Never show password entry, access tokens, or clipboard secrets.

Supporting diagrams may explain a relationship that cannot be seen in one screen. Label them as explanations and keep them short. They must not imitate application screens or claim unobserved product results.

## Capture once, revise efficiently

Keep recordings short enough that variable page loading cannot accumulate large timing drift. A roughly 15 to 30 second scene is a useful starting point, not a limit. Put slow operations between clips and show their completed result with a truthful transition such as "Once processing finishes...".

The structural verifier executes actions. A dry run can create the same record that a later recording tries to create. Inspect existing state before rerunning forms; reuse the captured result or use an authorized reversible record. Do not repeat external sends, payments, activation, or destructive actions to improve footage. Existing authorization persists, but recording tools do not broaden it.

For spoken actions, prefer an explanatory `wait`, the visible interaction, a result assertion, and a short narrated result hold. This gives the viewer context before the click and makes timing easier to control. Avoid narrated steps nested inside `if`; the narrator cannot know the chosen branch before capture. Split the flow into deterministic scenes instead.

Listen to one representative Piper sentence before a long synthesis run, using any user-provided product names. Keep the same voice across all parts. Voice scoring estimates intelligibility and acoustic properties; it does not decide the viewer's preferred tone. Use Ryan unless the user requests another voice. If Piper fails, repair it before choosing another engine.

Narration clips now cache by text and voice settings. A wording edit resynthesizes changed clips. Timing still uses measured audio and action estimates: inspect spoken instructions around clicks and scene cuts. Global stream duration alone does not prove synchronization.

## Delivery

Keep an uncaptioned master as the source of future edits. Use phrase-level aligned SRT cues. Export white bold captions on black boxes through `deliver-video.mjs`; choose top placement only when bottom captions cover important controls. Keep cues to two lines. Resolve any reported fast cues by adjusting narration or timing.

For paired delivery, provide the clean MP4, captioned MP4, and ASS/SRT files from the same delivery run. After audio changes, align the new narration before exporting. After timing changes, use one edit map for every variant. Read [delivery.md](delivery.md) for the JSON schema and examples.

Inspect one wide scene, one focus zoom, a text-entry scene, a result state, and the ending. Listen to the opening and edited sentences. Check that captions and highlights do not cover the controls being taught. Do not describe a technical validation report as proof of presentation quality.
