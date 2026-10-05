# Directed video production

## Fast image generation and SoL refinement, October 4

The [image/refinement research](fast-image-generation-research-2026-10-04.md)
inspects SoL's process and pinned implementation, then measures actual RTX 3080
execution. SDXS produced 512px stills at 30.33 ms median; an independent tiny
student runs a 720p forward pass in 3.03 ms but fails its held-out quality test.
These are research baselines, not a coherent cinematic-video runtime.

## Geometric-density research, October 4

Follow-up [geometry and scene-renderer research](geometry-scene-renderer-research-2026-10-04.md)
covers the hybrid renderer/painter proposal, InSpatio-World 1.5 source and memory
audit, footage sources, and a successful but narrowly restricted image-transport
experiment. No real-time natural-video or Seedance-quality result is established.

The [research report](geometric-density-video-research-2026-10-04.md) documents
Sophontic's public claims and missing recipe, related reproducible methods,
commercial constraints, and the local implementation path. The independent
`research/video_density` pilot has now trained nine 24,027-parameter synthetic
video models on CPU. Relational supervision did not improve overall generation
quality; all arms remained below trivial static baselines. Six tests pass and
all nine checkpoint evaluations reproduce exactly. This is a working research
harness, not a compact production video model or a Sophontic reproduction.

## LTX staged quality runtime, October 4 (source only)

The newer retained result at `data/ltx-preview-validation/1790873870884/result.json`
corrects the older readiness notes below: LTX completed 73 frames at 512x256 in
96.88 seconds. The clip decoded successfully, but the owner rejected its face
ghosting and cropping. This establishes execution, not production quality.

`scripts/ltx-quality-smoke.ts` now separates sampling and decoding into fresh,
supervised Windows processes. Native SaveLatent saves the final video tensor;
SHA-256 identifies the tensor passed to all three decoder comparisons (16, 64,
and 96 frame temporal tiles). The decoder stages load only the video VAE, with
an 8 GiB commit / 2 GiB working-set ceiling. Sampling retains its 16 GiB commit /
4 GiB working-set ceiling. System reserves remain 6 GiB physical RAM and 8 GiB
commit. A completed sampling result can be reused with `--resume=<run-folder>`.
`--portrait` changes the source and latent aspect ratio together to retain the
full reference face. Decoder quality and framing are separate experiments.

Dynamic supervision now also stops its owned job at 8 GiB **whole-device** usage,
including other applications. This is a 250 ms sampled stop condition, not a
hard allocator cap or a guarantee that instantaneous peaks cannot exceed it.
The existing dynamic allocator still targets 3 GiB free GPU memory, streams
weights asynchronously, and bounds pinned staging at 1 GiB. H3 is unchanged.

Validation: three workflow tests verify unchanged sampling controls, independent
decoder graphs, and aligned portrait dimensions. Eight Windows limiter tests
pass, including stopping at 8 GiB used even when 2 GiB remains free. TypeScript
and targeted lint pass. The initial new comparison was refused before model
loading because available Windows commit was below the sampling startup
requirement of 24 GiB. No improved-quality clip or Seedance parity is established.
Production holds remain in place, and these changes have not been packaged.

Upstream research: [LTX block streaming](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-core/src/ltx_core/block_streaming)
provides RAM/disk-to-GPU block reuse. This is a candidate for a deeper adapter;
the diagnostic above continues to use the installed ComfyUI dynamic loader.
Do not label the diagnostic as a new native block-streaming implementation.

Sophontic's [model page](https://sophontic.ai/models/) describes training internal
model geometry for compact reasoning. As inspected October 4, the model card,
evaluation report and access details are forthcoming; it explicitly withholds
the training recipe. Applying that approach to video remains a research
hypothesis. It must not be described as replicated or as demonstrated video
model compression. No model training was performed in this change.

## LTX dynamic configuration correction, October 1 (source only)

The desktop launcher and isolated preview now share `LTX_LIMIT_ARGS` and `LTX_RUNTIME_ARGS`. LTX enables dynamic VRAM, two asynchronous offload streams, cudaMallocAsync, BF16 GPU VAE and the default GPU text encoder. The LTX bootstrap caps pinned staging at 1 GiB. It keeps the 8 GiB commit / 4 GiB working-set diagnostic profile and the 6 GiB physical / 8 GiB commit system reserves. H3 retains its legacy profile and diagnostic hold.

Dynamic allocations are not covered by a claimed PyTorch 5 GiB hard limit. ComfyUI targets GPU headroom, while an independent supervisor samples device-wide NVML memory and temperature every 250 ms and terminates its own job below 1 GiB GPU free or at 78 C. This is a sampled watchdog, not a hard allocation ceiling or a guarantee against driver failure. Initial GPU headroom must be at least 3 GiB. No driver, pagefile, power or Windows restart setting was changed.

Seven limiter tests (including a mocked dynamic GPU pressure stop that loads no model) and 40 video tests pass. The first corrected preview attempt, `data/ltx-preview-validation/1790865632481`, was held before child launch: available commit was 16,219,701,248 bytes, below the required 17,179,869,184 bytes. No model loaded, and no clip was produced. The owner has been asked to close unused apps before the controlled retry. The corrected configuration is not installed, and the LTX production hold remains in place.

Primary comparison: [the workflow author's recorded 8 GB setup](https://github.com/reventadirecta/LTX-2.5-I2V-8GB-VRAM). The pinned staging cap and independent watchdog are Signal-specific differences; the author's render speed does not establish this profile's performance.

## Creative ad director and LTX 2.5, September 30

Signal 0.53 adds a separate creative advertising director above the existing shot director. It reads the current product website, searches for the buyer's workflow problem, and retains the pages used. It proposes three distinct approaches: demonstration, visual metaphor and relatable scene. Each includes exact source excerpts, a test hypothesis, opening scene, instructions for recording the real product, narration and a call to action. It rejects invented quotations and does not treat search rankings or one source as market demand. The saved story bible and approved cast inform concepts; Joey's supplied directing material remains creative reference material rather than app instructions.

The production path keeps the generated opening separate from actual product footage. A concept queues one five-second shot using the selected renderer. After playback approval of the hook and an imported product recording, Signal queues a narrated edit with captions and an end card. Duplicate clicks retain the original jobs. Publishing still uses the existing separate delivery flow. Requested concept research is selected before recurring background planning at the next available inference slot; it cannot interrupt inference already running.

Research: Google's [ABCD creative guidance](https://support.google.com/google-ads/answer/14783551?hl=en-1) supports an early hook, clear product branding, a focused customer benefit and a concrete next step. These are design principles, not a prediction of sales. The [user-supplied AI Search video](https://www.youtube.com/watch?v=ig3PUfSow5Y) links to the [native ComfyUI LTX 2.5 tutorial](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5). Its metadata and linked technical sources were inspected; this record does not claim a full viewing of the video.

The local adapter uses the [workflow author's 8 GB baseline](https://github.com/reventadirecta/LTX-2.5-I2V-8GB-VRAM), with W4A8 transformer and text encoder, BF16 video/audio VAEs, a spatial upscaler, two sampling stages and tiled decoding. It produces silent preview footage; the existing CPU editor adds narration. It uses native nodes, one starting image and no Blender guide. The RTX 3080 in this PC has 10 GB VRAM. Signal retains its existing 16 GiB commit and 5 GiB Torch allocation caps, CPU decoding, headroom watchdog and disabled dynamic offloading. Those constraints differ from the author's measured setup, so their speed and memory results cannot be attributed to this PC. H3's incident hold is retained.

Hugging Face authentication and gated-file access were verified locally. Five model files total 25,957,484,024 bytes. Downloads use pinned repository revisions and upstream SHA-256 verification. Full-file transfers stalled, so a bounded, resumable byte-range downloader verifies every response range and the final file hash. Authentication stays local; tokens and signed download URLs are not logged.

Validation: 71 targeted tests, TypeScript and targeted lint pass. The packaged app passes 40 screen/size checks with no renderer errors, including exactly one concept panel after refresh. A duplicate React key found during packaged testing was corrected. Live public-source research and CPU inference produced three Lemonade concepts, with one citation correction pass. Editorial review removed unsupported speed claims and guessed interface actions before saving the drafts to the owner profile. These are concepts, not completed or published ads. Evidence: `data/ad-director-live-validation/1790814141866/reviewed-result.json`.

All five LTX files are downloaded and their upstream SHA-256 hashes verified. Native ComfyUI V3 COMBO model menus are supported alongside legacy menus. Actual rendering remains unverified: the normal capped startup refused insufficient commit headroom; a separate 8 GiB commit / 4 GiB working-set preview then encountered Windows error 1455 opening the 10.6 GB text encoder. An experimental read-only loader opened that encoder successfully without enabling dynamic GPU allocation, but the full preview was stopped by the watchdog when available RAM reached 6,192,840,704 bytes, below the reserved 6 GiB. Available commit at that checkpoint was 10,287,108,096 bytes. No video completed. Evidence: `data/ltx-preview-validation/1790815801325/limits.json` and `renderer.log`.

The experimental read-only loader is diagnostic source only and is not bundled into the app. The owner profile has an LTX diagnostic hold so agents and manual queueing cannot repeat the unsuccessful render automatically. H3's separate incident hold is unchanged. Do not remove either hold or lower the system-memory reserves to claim readiness. A successful complete render and visual review under the retained limits are still needed before enabling LTX production. No pagefile, driver, power or restart settings were changed.

Implementation and validation record, 2026-09-19. Installed Signal 0.32.3 includes the video workflow, capped renderer, CPU ad assembly, capped local narration, script captions and music mixing. A completed H3 clip remains unverified.

## H3 recovery work after 0.32.3 (not installed)

The owner requested a working H3 render within the saved caps. An isolated component test now loads Kijai's INT8 ConvRot video VAE and completes a 320×192 single-frame encode/decode in fp16 on the RTX 3080. Recorded checkpoints used 5,906 MiB process private memory and 2,680 MiB Torch GPU allocations; the Windows job exited with code 0. Evidence: `data/h3-component-validation/{component,limits}.json`. These readings are checkpoints, not a continuously measured peak or a complete generated video.

An isolated Ref2VA trial used the existing Qwen3-VL 4B FP8 encoder, ClipProj v3.1 ridge projection, quantized VAE, 608×352 output and 56 frames. It passed reference conditioning but failed opening the main diffusion checkpoint with Windows error 1455. It remained capped and exited; no video was produced. Evidence: `data/video-h3-low-memory-validation/`. The next experiment separates preparation, sampling and decoding into fresh capped processes, preserving tensor checkpoints with SHA-256 and safetensors rather than retaining every model together. Its checkpoint roundtrip/corruption test passes under a 4 GiB CPU-only job.

Research: [8 GB workflow author's tested setup](https://github.com/reventadirecta/MiniMax-H3-ComfyUI-8GB-VRAM), [ClipProj source and limitations](https://github.com/nicolab28/ComfyUI-ClipProj), [Kijai's quantized VAE](https://huggingface.co/Kijai/MiniMax-H3-experimental), [projection matrices](https://huggingface.co/NicoLab28/ClipProj-MiniMax-H3). ClipProj checkout is `c01ba8fb8f41b4f2094dbd0b185cdc238fb6134c`, isolated under Signal's runtime. Its Ref2VA path explicitly supports image and video reference blocks but is experimental; identity, motion fidelity and output quality remain to be verified. No shared ComfyUI source was patched, no resource limits were raised, and no browser was launched.

## Workflow

Creative studio retains a story bible and approved character references separately for each business. Characters can be imported, generated locally with Krea 2, or generated through Higgsfield with owner-supplied API credentials. Every shot freezes the approved cast and bible revision. A structured director plan describes composition, lighting, performance, timed beats and camera motion. Fixed Blender code creates a camera and motion reference; the model never supplies executable Python.

MiniMax H3 Ref2VA receives the same ordered character images and the Blender guide. Local ComfyUI is the default. The optional MiniMax cloud renderer requires its own key and explicit selection; a local failure never switches to a paid provider. Saved remote task IDs survive restarts; an uncertain submission is not automatically retried. Sampled output frames are compared with the approved cast. Sample review does not establish smooth motion, audio quality, or every-frame identity; the full clip still needs playback review.

The current Blender adapter supports simple humanoid blocking, walking and camera movement. Arbitrary acting gestures remain open. CPU editing joins approved clips with source audio, editorial text overlays, narration, imported music and an end card. Automatic transcription of existing clip dialogue remains open.

## Finished ad editing

Creative studio → Video production → Assemble a finished ad accepts imported MP4 footage or completed generated shots after owner playback approval. An edit freezes 1–6 product-owned source assets with their SHA-256 identities, ordering, trims and text. Each segment is 1–15 seconds; the edit plus its 3-second end card is at most 60 seconds. The destination must match the business's configured website origin. Approval of the source footage does not approve the resulting ad: completed edits stop for full playback and product-claim review.

FFmpeg encodes sequentially on CPU with two video threads and one filter thread, preserving source sound and inserting silence for silent clips. It creates portrait 720×1280, landscape 1280×720 or square 720×720 H.264/AAC MP4s. Text is written to separate UTF-8 files with expansion disabled; wide text wraps and shrinks to fit. A copied system font avoids path escaping problems. Local-only input protocols, bounded durations, cancellation and output size/format checks apply. The original assets remain unchanged. This uses neither H3 nor paid APIs, works offline, and does not publish.

`video.assemble` lets an active product-owned marketing task queue the same edit using approved clip IDs. It shares the existing daily video-job allowance, keeps one durable job per task, and ends the marketing cycle so the editor can run. Agents cannot approve footage or replace an authorized public-text operating cycle with an unpublished edit.

Validation: three actual 7-second MP4 fixtures completed in all output shapes. FFprobe verified dimensions, duration and audio; FFmpeg audio measurements verified the tone-bearing source stayed audible and silent footage/end cards remained silent. Caption punctuation and a literal `%{frame_num}` string rendered without filter expansion. Extracted frames were visually inspected. Development and packaged UI checks exercised selection, offline editing, preview, approval, business switching, and desktop/narrow layouts. These colored fixtures validate editing behavior, not real ad quality or audience results. Evidence: `data/video-ad-validation/result.json`, `data/video-validation/ad-editor-*.png`, and `scripts/video-ad-smoke.ts`.

Primary implementation references: [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html) for drawtext, scaling, padding and audio processing, and [FFprobe](https://ffmpeg.org/ffprobe.html) for bounded structured media inspection.

## Local narration and music

The ad editor can install Kokoro once and generate narration locally with four stock English voices, speed 0.8–1.2, a start offset and optional script captions. The runtime is isolated under `%LOCALAPPDATA%/Signal/runtime/narration`, using Python 3.11, `kokoro-onnx==0.6.1` and CPU ONNX Runtime. The installer checks the upstream SHA-256 values for the 325,505,369-byte FP32 model and 28,214,398-byte voice file, and retains a dependency inventory. The model author's license is Apache 2.0; the ONNX adapter is MIT. Sources: [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M), [ONNX adapter](https://github.com/thewh1teagle/kokoro-onnx), [pinned model release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1).

Each narration runs inside a 4 GiB Windows job with the same 6 GiB physical-memory and 8 GiB commit-headroom stop conditions. It imports no Torch and selects only CPUExecutionProvider, with two intra-operation threads, one inter-operation thread and thread spinning disabled. The supervisor must assign the memory limit before the voice worker starts. Pause/cancellation terminates the supervisor and its child. These settings follow [ONNX Runtime thread controls](https://onnxruntime.ai/docs/performance/tune-performance/threading.html).

Narration is rendered in bounded text chunks, with sentence cue times measured from the resulting audio. Longer sentence captions are split into readable blocks using proportional timing; this is not word-level alignment or transcription of source footage. Captions move above the end-card headline when speech continues over the card. A script exceeding the edit's remaining time fails with an instruction to shorten the script, rather than silently truncating speech.

Imported WAV/MP3/M4A/FLAC tracks are normalized to local PCM WAV, retained with SHA-256 identity and scoped to their business. Edits freeze their selected music asset. Music loops at the chosen level (default -22 dB) and fades out at the end. Narration receives loudness normalization; retained clip audio is lowered when narration is present, or can be muted. The final mix has a peak limiter. Agents can select this business's music and add narration through `video.assemble`; they cannot import arbitrary audio paths or approve/publish the result.

Actual verification: a 7-second portrait fixture includes 3.547 seconds of generated speech, retained clip sound, looping music, captions and an end card. Both source and music tone components survived; measured speech RMS was 0.125, peak amplitude 0.593 and clipped sample count zero. The worker reported CPU-only execution, enforced 4 GiB cap and exit code 0. A deliberately overlong script was rejected. Five small Windows limiter tests pass, including a CPU-only worker that never imports Torch. Development UI tests completed offline narration/music assembly, preview and final approval. Listening quality and pronunciation still require full playback review; synthetic tone/colored-footage checks do not establish real ad quality. Evidence: `data/video-audio-validation/result.json`, `audio-levels.json`, `narration-limits.json`, `scripts/video-audio-smoke.ts`, and `data/video-validation/narration-controls.png`.

## Supplied material and adaptation

- The owner's `MICKMUMPITZ_MINIMAX-H3_AI-RENDERER_1-1.json` is the primary local-render reference. Signal's Mick preset uses four steps, `er_sde`, simple scheduling, the Joyfox four-step LoRA at strength 1, video/audio sigma shifts 12/5, and -12 dB output audio. It omits the bypassed EasyCache and comparison layout. Native ComfyUI video I/O replaces custom VHS/helper nodes.
- The default smaller checkpoint is Kijai's W4A8 Ref2VA variant. The original INT8 checkpoint remains selectable. Local frames follow H3's 17k+5 grid; Signal rounds up and extends the motion guide and prompt timeline together to preserve the ending.
- The supplied `260615_MICKMUMPITZ_FLUX_KLEIN_9B_V01.json` is a separate still-image look-development workflow. Its 9B weights have different commercial terms; MiniMax permission does not cover them. It is not silently installed or used. Existing Krea 2 provides the verified local character-image path.
- Joey's story, character and directing files inform the structure of creative data. Their contents are reference material, not executable instructions or privileged agent policy.

Primary references:

- [Mick Mumpitz workflow explanation](https://www.youtube.com/watch?v=Q2oVBVQNQ_U)
- [ComfyUI setup resource supplied by the owner](https://mickmumpitz.ai/posts/comfyui-getting-153738117?l=de-DE)
- [Kijai's smaller H3 checkpoint](https://huggingface.co/Kijai/MiniMax-H3-experimental)
- [Comfy H3 encoder and VAE files](https://huggingface.co/Comfy-Org/MiniMax-H3)
- [Joyfox four-step H3 LoRA](https://huggingface.co/joyfox/MiniMax-H3-Turbo)
- [Separate community RTX 3080 experiment](https://gist.github.com/junzhisangcun/bb5b541d8d369636a075442dc69e14bd)
- [FLUX Klein 9B model terms](https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8)
- [Higgsfield API documentation](https://docs.higgsfield.ai/docs)
- [Krea 2 model terms](https://github.com/krea-ai/krea-2/blob/main/docs/KREA-2-COMMUNITY-LICENSE)

The separate 3080 experiment uses different weights, a LightX2V LoRA, audio shift 3 and sparse attention. Its reported timing is not a measurement on this owner's computer. Sparse attention remains optional and requires separately installed compatible nodes/dependencies; managed ComfyUI disables custom nodes by default.

## Owner setup and authorization

The owner supplied a MiniMax email explicitly authorizing AIon X LLC to use MiniMax H3 and MiniMax H3 Works, conditioned on the commitments in its request. H3 setup proceeds on that authorization. No further H3 permission prompt is required. This records the supplied authorization rather than inferring rights solely from revenue or private deployment.

The verified machine has an RTX 3080 with 10 GB VRAM and 32 GB system RAM. Five selected H3 weight files total about 34 GB on disk. The setup script resumes partial downloads and verifies SHA-256 against published Hugging Face metadata before exposing completed model filenames. It does not download executable custom nodes.

Portable Blender 5.1.2 and FFmpeg 9.0.1 were downloaded from their distribution sources and checksum verified. They run with hidden windows. Managed ComfyUI uses loopback, disables browser launch and pinned memory, and discovers Signal's separate H3 model directory through an extra-paths file. Signal supplies its own user profile and SQLite database so sharing portable binaries with another app does not conflict on the runtime database. Existing ComfyUI source and model directories are preserved.

### September 19 unexpected restart: diagnostics held

The staged low-memory experiment completed preparation and all four sampling steps, saving `data/video-h3-staged-validation/checkpoints/samples.safetensors`. Sampling ran with a 16 GiB commit ceiling, an 8 GiB hard working-set maximum and a 5 GiB Torch GPU ceiling. Six small limiter integration tests passed. These results do not establish machine stability or completed video output.

Windows subsequently booted at 09:29:47 Pacific on September 19 and recorded Kernel-Power 41 with BugcheckCode 0. The user reported a crash during the decode investigation. This establishes an unclean restart, not its cause or the precise operation responsible. No completed H3 MP4 was verified. The post-restart decode attempt was stopped immediately on the report; its saved `running` job/limit snapshots are stale. Evidence is preserved in `data/video-h3-staged-validation/decode/incident.json` and `kernel-power-41.xml`.

All owned H3 diagnostic processes and the port 8212 listener were verified absent. `%LOCALAPPDATA%/Signal/runtime/h3-diagnostic-hold.json` now prevents `scripts/h3-low-memory-smoke.mjs` from launching any stage, including in a fresh output directory. The refusal was verified without starting Python. Do not clear the hold or resume GPU rendering automatically on task continuation. Investigate the restart first. This guard applies to the diagnostic launcher, not the installed Signal binary; these experimental changes have not been packaged. Keep H3 out of unattended use.

### Memory limits after the September 18 restart

Uncapped H3 trials reached 98–99% Windows commit use. Two trials were deliberately interrupted; the final test became unresponsive, followed by an unclean reboot. Kernel-Power 41 records BugcheckCode 0, which does not establish the cause. No completed H3 clip was recovered. Do not repeat the uncapped test.

Managed ComfyUI now starts behind `limited_runtime.py`. Windows enforces a 16 GiB process and descendant-job commit ceiling before the child can import Torch. The supervisor remains outside that job and polls native memory counters every 250 ms. It refuses startup without headroom and terminates its renderer if available physical RAM falls below 6 GiB or available commit falls below 8 GiB. Closing the supervisor also terminates its worker. A stopped renderer requires a deliberate restart; queued video does not automatically resubmit.

The child sets a 5 GiB PyTorch GPU allocation ceiling (at most half of device VRAM), uses the native allocator, disables dynamic VRAM and asynchronous offload, moves VAE work to CPU, and requests low-VRAM loading with a 5 GiB reserve. The GPU ceiling excludes driver/context allocations; it is not a GPU power cap. These controls favor bounded use over speed and may reject a workload that cannot fit. They do not prove H3 can complete within these limits or explain the earlier shutdown.

Validation: a real Windows 256 MiB test denied further allocation after 240 MiB; a 128 MiB GPU test denied the next allocation. Four small integration tests pass for allocation enforcement, startup refusal, low-memory termination, and child cleanup after supervisor death. The actual ComfyUI server starts under the wrapper with LOW_VRAM and the native allocator, reports enforced limits, and stops cleanly with no queued renders. No H3 render was started during these checks. Video creation rejects an external runtime whose limiter Signal cannot verify.

A subsequent isolated capped H3 test on September 19 submitted prompt `28826951-93cb-48ff-9ec4-763d331c44b1`. It failed while constructing the CPU VAE, with a native Torch access violation; the supervisor reported a memory-headroom stop. No output video was produced. Both worker and supervisor exited, Windows boot time remained unchanged, and a subsequent system counter showed 41% commit usage with about 15 GiB physical RAM available. No automatic retry or limit increase followed. Evidence is in `data/video-h3-capped-validation/` (`limits.json`, `job.json`, `workflow.json`, `resources.jsonl`, and `result.json`). The Electron validation launcher exited before executing its script; a Node-only isolated fixture submitted this test through the same local renderer adapter.

The watchdog's `ullAvailPageFile` counter is conservative process-available commit, not an exact system-wide commit measurement; Microsoft documents that it can be lower than system availability. Its low reading establishes the stop condition, not a precise system-wide exhaustion percentage. See [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex). Slower settings cannot guarantee that H3's minimum allocations fit these limits. Keep H3 out of unattended operation until a completed capped render is verified.

Primary references: [Windows job memory limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information), [Windows memory counters](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/Memory/memory-performance-information.md), and [ComfyUI startup options](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/cli_args.py).

The marketing agent can read this business's approved cast, bible and recent shot states through `video.status` and save a local shot through `video.create`. A running, product-owned marketing task is required. Retrying the same task retains its original frozen shot. The default allowance is two agent shots per rolling 24 hours across businesses, configurable from zero to twelve; failed jobs also consume that allowance. Agents cannot approve characters, select paid cloud rendering, or publish these clips. Successful queueing ends the agent cycle before video processing uses the GPU. Public text operating cycles continue to require their configured publication tool rather than substituting an unpublished video.

## Evidence and remaining checks

- Actual local Krea 2 character reference completed in 36.45 seconds and was visually inspected (`data/video-research/cast.png`). This is a fictional test identity, not an approved business character.
- Actual Blender guide rendered, saved a `.blend` and MP4, and yielded six review frames. The first noisy preview was rejected; the 16-sample CPU-denoised rerender was visually inspected (`data/video-blockout-validation/preview.jpg`).
- Native ComfyUI video encoding was exercised. Windows output subfolders and the current SaveVideo codec input are handled.
- Twenty-one video tests pass, including business/cast isolation, restart recovery, uncertain-submission handling, local-only character generation, explicit cast approval, agent task ownership, retry deduplication, daily limits and stopped-renderer recovery.
- Development UI checks after the agent integration cover saved local presets, business switching, desktop/narrow layouts and renderer exceptions. The desktop rendering setup was visually inspected. TypeScript and production build pass.
- All five H3 weight files are downloaded and checksum verified. A completed H3 render within the new limits, full-clip motion/audio review and cloud-provider end-to-end checks remain unverified.
- Signal 0.32.0 was packaged and installed silently with `/NORESTART`; installed version and video UI checks passed. The packaged limiter matches the source bytes. All validation render processes were stopped.

This milestone does not establish a completed marketing operation or guaranteed sales.
