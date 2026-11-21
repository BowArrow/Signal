# Local avatar and content studio: October 19, 2026

Implementation update: the first local Chatterbox + MuseTalk preview is now
generated. See [tested setup and validation](local-avatar-validation-2026-10-19.md).
The research-stage observations below describe the earlier investigation.

## Recommendation

Build a local presenter pipeline around Chatterbox voice cloning and MuseTalk
1.5 lip-sync, using real recordings of Casey for natural movement. Compare
Qwen3-TTS 0.6B Base against Chatterbox before choosing the voice backend.
Keep LTX available for separately reviewed generated shots and an experimental
audio-to-video track. Extend the existing Demo Studio and add a narrow MCP
adapter once the avatar quality test passes.

This is a researched implementation choice, not a validated generated avatar.
No avatar model was installed or run in this investigation. No content was
published, account connected, recurring task enabled, or sales result claimed.

## Machine and existing implementation

Live hardware inspection: RTX 3080, 10,240 MiB VRAM, Ryzen 7 5800X, approximately
32 GB system RAM. About 1.6 GiB GPU memory was already occupied at inspection.
Use sequential GPU jobs and retain resource reserves; do not keep TTS, LTX,
lip-sync and a local language model resident together.

The workspace already contains:

- `apps/demo-studio/`: local authenticated command API/client, real product
  capture, session assets, trim/zoom/text/audio edits and four output formats.
- `src/core/video/`: supervised local rendering, CPU Kokoro stock narration,
  assembly, campaign and publishing components. Stock narration is not cloning.
- LTX model/runtime directories and FFmpeg/FFprobe on this machine.

The current Demo Studio edit contract allows 12 shots / 120 seconds. Long-form
YouTube needs resumable chapter assembly and a longer timeline. Its current
capture implementation is also specific to Lemonade; a general CineGen-like
studio needs broader project and media support.

The October 15 validation record reports a 5.04-second, 384 x 512 LTX preview
rendered in about 129 seconds. That is historical local evidence, not a fresh
benchmark or production approval. The current LTX prompt explicitly requests
silent scenes without talking. Avatar generation requires a distinct pipeline.
Today, read-only `status` and `ltx.status` requests through the saved Studio
connection both returned `fetch failed`; current service readiness is unverified.

References: [Studio](../apps/demo-studio/README.md),
[LTX validation](ltx-studio-validation-2026-10-15.md).

## Model choices

| Component | First choice | Evidence and limit |
| --- | --- | --- |
| Cloned speech | Chatterbox | Local reference-conditioned speech; MIT code/model terms; pacing and expression controls. Also provides a voice-conversion example. |
| Voice comparison | Qwen3-TTS 12Hz 0.6B Base | Reference audio plus transcript, reusable clone prompts; Apache-2.0 model card. Use Base for cloning, not the preset-speaker CustomVoice model. |
| Presenter | MuseTalk 1.5 | Changes speech-related facial regions in existing footage. Upstream documents Windows inference, a low-memory example, and commercial use of its own model. |
| Alternate lip-sync | LatentSync 1.5 | Documented 8 GB minimum leaves limited desktop headroom. Version 1.6 requires 18 GB in its documented inference configuration. Dependency model licensing needs review. |
| Generated motion | LTX audio-to-video / Dub-It experiments | Current upstream has audio-conditioned and rephrasing pipelines. Fit, identity, synchronization and quality on this PC remain untested. |

MuseTalk uses a 256 x 256 facial region and documents identity-detail and jitter
limitations. A 1080p container does not make that region native 1080p quality.
The source supplies gaze, blinking and gestures; lip-sync does not invent
meaning-appropriate new body acting. Prefer several natural source takes and
short presenter passages intercut with useful demonstrations.

EchoMimic V3's upstream low-memory example is 12 GB, above this GPU's physical
capacity. It is not the first deployment candidate. Avoid assuming every
permissively licensed repository includes commercially usable dependency
weights: InsightFace explicitly separates its MIT code from non-commercial
pretrained models. Record exact code revisions, model hashes and dependency
terms when installing the selected stack.

Primary sources checked October 19:

- [Chatterbox code and usage](https://github.com/resemble-ai/chatterbox)
- [Chatterbox model terms](https://huggingface.co/ResembleAI/chatterbox)
- [Chatterbox voice conversion example](https://github.com/resemble-ai/chatterbox/blob/master/example_vc.py)
- [Qwen3-TTS usage](https://github.com/QwenLM/Qwen3-TTS)
- [Qwen 0.6B Base model terms](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)
- [MuseTalk requirements, limitations and terms](https://github.com/TMElyralab/MuseTalk)
- [LatentSync requirements](https://github.com/ByteDance/LatentSync)
- [LTX pipelines](https://github.com/Lightricks/LTX-2)
- [EchoMimic V3](https://github.com/antgroup/echomimic_v3)
- [InsightFace model terms](https://github.com/deepinsight/insightface/tree/master/python-package)

## Supplied recording and prepared assets

The owner supplied `C:\Users\cshor\Videos\Camo Studio Recording 2026-09-21 14-09-41.mp4`.
FFprobe reports 262.95 seconds, 1280 x 720, approximately 30 fps, and stereo
48 kHz AAC. Sampled frames show a visible face, largely frontal posture and
natural movement. The hat, headset, clothing and room remain part of this
source appearance. Some sections include leaning toward the camera or looking
down, so select takes rather than looping the entire recording.

The owner explicitly requested no Camo watermark. The selected landscape crop
is 1024 x 576 at x=128, y=0, excluding the lower-right mark while retaining the
head in the selected take. This is a tighter composition at lower native
resolution. The original is untouched.

Local, Git-ignored artifacts under `output/avatar-research/2026-10-19/`:

- `avatar-motion-reference-no-watermark.mp4`: silent 20-second source take,
  80-100 seconds, cropped and converted to 25 fps; full-file decode passed.
- `landscape-crop-preview.jpg` and `cropped-motion-contact-sheet.jpg`: visual QA.
- `voice-reference-candidate.wav`: mono 24 kHz, 188.7-199.0 seconds, loudness
  normalized. This is extracted source speech, not synthesized speech.
- `reference-transcript.json`: local CPU faster-whisper transcription with word
  timings. Automatic text requires checking before use as a cloning transcript.
- `reference-preparation.json`: source times, transforms and asset hashes.
- Audio-analysis logs. The 25-45-second sample measured roughly -36 dBFS RMS
  on both channels. Overall level alone does not establish noise or voice quality.

The voice candidate needs listening review. Visual sampling and successful
transcription do not prove clean audio or natural cloned cadence.

## First acceptance test

1. Install isolated voice and presenter environments; preserve the existing
   working Comfy/LTX Python installation. Pin the tested dependencies.
2. Compare Chatterbox and Qwen on three identical 10-20-second scripts: ordinary
   explanation, an energetic opening, and a calm product call to action.
3. Compare voice identity, pronunciation, speed, pauses and emphasis against the
   supplied recording. Reference-based TTS approximates delivery; it does not
   guarantee exact cadence on new text. Original recorded delivery is the
   reference for exact timing; voice conversion is a separate test when needed.
4. Run MuseTalk first with original speech, then with the preferred synthesized
   speech. This separates lip-sync defects from voice defects.
5. Inspect normal-speed playback for mouth timing, beard/teeth flicker, seams,
   facial identity, gaze, movement repetition and unwanted watermark visibility.
   Record render time, peak VRAM/RAM, complete decoding and source/output duration.
6. Finish one 30-60-second video with presenter, actual product footage, accurate
   captions and one relevant action. Produce landscape and portrait compositions.
   Choose the voice and visual result with the owner before batch production.

## Local studio and agent interface

Proposed flow:

`content brief -> script -> cloned speech -> presenter clips -> real demos / optional LTX shots -> timeline -> reviewable export -> publication receipt -> measured outcomes`

Reuse the Studio asset store and edit renderer. Add provider workers behind a
single GPU job queue, with cancellation, progress, durable IDs and retries that
do not duplicate work. Persist script versions, source times, voice profile,
model revisions, seeds, render settings and output hashes.

Proposed MCP tools, not existing capabilities:

| Tool | Purpose |
| --- | --- |
| `studio_capabilities` | Installed providers, health, formats and limits |
| `avatar_profile_prepare` | Register selected local footage and voice references |
| `voice_render` | Submit a script and delivery settings; return job ID |
| `avatar_render` | Animate a selected take using an audio asset |
| `footage_generate` | Submit a bounded optional LTX shot |
| `timeline_render` | Assemble a versioned edit with audio and captions |
| `job_status` / `job_cancel` | Inspect or cancel an owned task |
| `asset_inspect` | Return metadata, previews and validation results |
| `content_package` | Export video, thumbnail, title, description and tracked destination |

The MCP layer should call the same local operations as the UI. Keep structured
inputs and project-scoped assets; no arbitrary shell tool is needed. Use a local
transport for Codex and retain the existing authenticated CLI for environments
that can access the computer but cannot directly consume that MCP server.

Official dots documentation supports connected-computer work while the PC is
online and ChatGPT is open. It does not establish that a newly written local MCP
server is automatically available to this dot. Verify the actual connection
with one read-only status call followed by one small render.
[Official computer access documentation](https://learn.chatgpt.com/docs/dots/computers-and-apps).

## Content and sales operation

Signal should give the studio one specific buyer problem, product and desired
next action per video. A practical first format is a short presenter opening,
a real demonstration solving that problem, and a concise invitation to try it.
Create Shorts from the useful demonstration segments, with separate framing
and captions. The supplied recording can also support an educational channel;
product promotion should fit the topic and audience instead of appearing in
every clip indiscriminately.

Track the whole path: published URL -> viewing/retention -> tracked visit ->
trial or inquiry -> first product value -> purchase. Missing attribution remains
unknown. Select the next topic using those results and actual audience feedback.
Render counts, drafted posts and completed agent tasks are not sales evidence.

Publishing remains a distinct connected-account operation with its applicable
authorization. This research does not activate a campaign or resume an earlier
paused revenue goal. Local media inference avoids per-render cloud model fees;
dots orchestration still uses its applicable account allowances.
