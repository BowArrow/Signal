# Alex creator and product campaign pipeline

Alex's shared creator identity and editorial strategy live in `campaigns/alex-creator/account.json`. See the [account setup](../../docs/lemonade-tiktok-account.md). His public Personal account centers on relatable everyday content, useful finds and dry humor. Lemonade is the first product campaign. Start with ten relatable posts, three useful standalone posts and one commercial post per fourteen posts, then adjust from audience evidence. This is an experiment, not a platform rule.

The Lemonade campaign is in `campaigns/lemonade-tiktok/`. Its three prepared scripts are commercial alternatives, not the full launch calendar. Creator-first launch scripts live in `campaigns/alex-creator/launch-briefs.json`; these are explicitly original tests, not verified viral adaptations. Generated creator media stays in `output/alex-creator/`. This is a standalone local pipeline beside Signal Demo Studio; it is not yet a screen in the installed Signal desktop app.

## Supervised local production qualification

The optional [low-resolution LTX + RelayVSR path](./RELAYVSR.md) adds resumable long-form shot assembly, a distilled eight-step preview profile and a fully guided low-resolution alternative. It runs each GPU stage sequentially with stricter resource reserves. See `campaigns/alex-creator/relay-profile.json` for its current validation state; it does not replace the approved profile or enable recurring work.

For Fredward's daily operation, start with [FREDWARD.md](./FREDWARD.md). The durable CLI is `node apps/avatar-marketing/operator-cli.mjs status`. Configuration is `campaigns/alex-creator/automation.json`; the installed Windows task `Signal-Alex-Production-Worker` checks the queue every 30 minutes while signed in and awake. It renders one queued job with existing safeguards and does not publish. Fredward researches, reviews and schedules through the verified Metricool account. His recurring responsibility and actual delivery still require confirmation; local installation is not proof that TikTok posting is live.

The latest user review approved the five-second tripod take and performance direction: "Looks good; use this direction." Keep the approved Ryan voice and room-audio-v2 treatment. Alex uses warm facial expressions and restrained hand gestures in fixed eye-level framing. `speaking-tripod-high-check.json` is the approved reference configuration: `guided_speech_high`, native 768x1344, CFG 2.3, modality guidance 4, STG 1, image strength 0.7, and a 128-frame temporal decode window with 32-frame overlap. New shots and complete edits still need playback review; this approval covers the observed five-second take.

`diagnose-eyes-camera.py <render-folder>` writes eye crops across time, consecutive crops around a low-detail interval and background feature tracking. Inspect the images and playback. Blinks affect sharpness and feature tracking can drift; these diagnostics cannot certify identity, camera stability, lip sync or naturalness automatically.

Windows status readers can briefly block atomic file replacement. The supervisor bounds retries to 100 ms and retries a busy periodic report on its next watchdog iteration; resource checks, startup/terminal reporting failures and the caller's stale-heartbeat stop remain active. `tests/test_runtime_status.py` covers actual Windows sharing collisions and other I/O failures. The first high-resolution tripod attempt stopped at step 16 on this reporting collision, before producing any frames; it is recorded as a failed attempt, not a visual result.

`ltx-production.ts` retains the distilled balanced/quality profiles and adds `quality_temporal` with a 64-frame decode window and 16-frame overlap. Experimental `guided_native` (576x1024) and `guided_high` (768x1344) use the official INT8 development model, native-resolution denoising, 30 Euler steps, CFG 3, STG 1 at block 28 and modality guidance 3. They decode directly without a distilled refinement pass. Native ComfyUI CFG rescaling runs before its STG/modality hooks; this is an adaptation, not an identical upstream two-stage pipeline. A requested duration is not a hardware-quality guarantee. The older Demo Studio preview limit and diagnostic holds are retained. `render-local.ts` serializes supervised jobs and saves inputs, graphs, resource measurements, decoded MP4 and review frames. The runtime stops after each job.

Guided profiles require a verified `alex-guided-model-receipt.json`. `download-guided-model.py` downloads the pinned official model with resumable transfer and checks its byte count and SHA-256 before installation. The clean approved voice remains frozen during generation. The scheduler uses the upstream A2V default token anchor, avoiding resolution-dependent sigma collapse for longer native-resolution requests. See the [official A2V source](https://github.com/Lightricks/LTX-2/blob/main/packages/ltx-pipelines/src/ltx_pipelines/a2vid_two_stage.py) and [guidance defaults](https://github.com/Lightricks/LTX-2/blob/main/packages/ltx-pipelines/src/ltx_pipelines/utils/constants.py).

The production runner uses a 1 GiB resident working set for `guided_speech_high` and 2 GiB for other profiles, while retaining the 16 GiB commit ceiling, 6 GiB system RAM reserve, 8 GiB commit reserve and existing GPU/temperature watchdog. It does not close unrelated applications. The live job lock is shared with the voice runner. If a forced Windows/process termination leaves a lock, verify the recorded PID has exited before removing that single stale lock file. A failed job's inputs and error receipt remain available; no automatic duplicate generation is submitted.

```powershell
node --import tsx apps/avatar-marketing/render-local.ts campaigns/alex-creator/quality-check.json
npm run avatar:render -- campaigns/alex-creator/the-chair-closing-shot.json
node --import tsx --test apps/avatar-marketing/tests/production.test.ts
```

For visible speech, the shot manifest supplies a hashed narration WAV. Native LTX audio VAE encoding and a zero noise mask hold that audio fixed through both sampling stages; the original conditioned waveform is included in the output. This follows the [official A2V method](https://docs.ltx.io/open-source-model/usage-guides/audio-to-video), adapted to the installed quantized models. It needs real lip-sync review. A silent reaction preview does not validate A2V.

Qwen runs in isolated `data/avatar-runtime/qwen-env`, using CustomVoice 1.7B, Ryan and revision `0c0e3051f131929182e2c023b9537f8b1c68adfe`. Run `qwen-audition.py` through `src/core/video/limited_runtime.py` with RAM 16 GiB, working set 3 GiB and GPU 5 GiB. The 10 GiB attempt exited during loading; the 16 GiB attempt completed with 13.40 GiB peak job commit and at least 10.59 GiB system RAM free. Never run it alongside LTX; both scripts share an exclusive GPU job lock. `check-speech.py` checks the transcript and saves word timings; listening approval is separate. The user approved the 14.56-second Ryan chair take on October 22. Its model revision, speaker, settings and WAV hash are locked in `campaigns/lemonade-tiktok/voice.json` and reused across creator campaigns.

```powershell
& data/avatar-runtime/qwen-env/Scripts/python.exe -u src/core/video/limited_runtime.py --status output/alex-creator/voice/limits.json --ram-gb 16 --working-set-gb 3 --gpu-gb 5 -- apps/avatar-marketing/qwen-audition.py campaigns/alex-creator/launch-briefs.json --id one-thing
```

Validation on October 22: a 3-second silent test decoded in 142 seconds, a 6-second speaking test decoded in 163 seconds, and the full 14.708-second speaking take decoded at 576x1024/24fps in 262 seconds with the 2 GiB resident working-set setting. The full take's receipt is `output/alex-creator/renders/alex-d854d049-e6de-48c2-a16a-b5ea952ff0ea/receipt.json`. Peak whole-device GPU use was 6.88 GiB, minimum free system RAM 6.40 GiB, peak job commit 13.21 GiB and peak GPU temperature 75 C. Startup time is additional. A preceding 15-second attempt at the older 3 GiB resident setting was stopped by the system-RAM watchdog; its safeguards were retained, then the smaller resident allowance passed. Sampled frames retain the room and recognizable presenter. Playback/lip-sync approval remains separate, and 20-second requests have not yet been qualified.

The first captioned review copy is `output/alex-creator/exports/the-chair-0c855a0a-ec60-4e61-bb72-d13fecd1d9f4/video.mp4`. It fully decoded at 1080x1920 after upscaling; its decoded audio correlates 0.99997 with the approved waveform. **The user rejected its visual quality:** unnatural mouth/facial motion and blurred eyes. Both source and export receipts record the rejection, and publishing remains disabled. The old distilled profile generated its first stage at 288x512 before 2x refinement; 1080x1920 was an export upscale. A subsequent temporal-window test decoded, but did not establish natural motion quality.

The user requested a warm, informative presenter instead of the amused eyebrow-lift direction. The account performance notes, launch visuals and new shot prompts now use relaxed brows, gentle eye contact, a loose jaw and a brief sincere smile at a pause. Existing approved voice bytes are unchanged. The six-second warm trial is `output/alex-creator/renders/alex-7409166a-1072-4763-892f-eda147f9c29a`; it is a review candidate using the older distilled model, not a guided-quality result.

The official development INT8 checkpoint passed its pinned size/SHA check. A native 768x1344, 73-frame guided trial completed in 1,147 seconds with all safeguards enabled: `output/alex-creator/renders/alex-b29a5a2b-e711-44ed-b9bf-6940572f549a`. It was rejected because the mouth stayed almost closed during speech. Technical success is not A2V quality acceptance. The revised `guided_speech` experiment uses native 576x1024, CFG 2.3, modality guidance 4, first-image strength 0.7 and a simpler speech-focused prompt, retaining STG and all 30 steps. Its 121-frame, 5.042-second take decoded in 1,093 seconds: `output/alex-creator/renders/alex-0c0b424f-65f9-43c1-8a32-315bfbd9cb81`. Visible articulation returned; subjective naturalness and sound acceptance remain pending. `sound-dry.mp4` and `sound-room-v2.mp4` use identical frames and volume-matched audio. No full-length guided take is qualified yet.

`diagnose-talk.py` provides a CPU-only mouth-activity check with the existing MediaPipe installation. Audio-energy/mouth-aperture correlation is a rough diagnostic, not phoneme synchronization; it must never automatically shift audio. `lipsync-local.py` runs an optional supervised MuseTalk mouth-only refinement of a decoded LTX shot, with hashed models/source audio and one-to-one source frames. It shares the GPU lock with LTX/voice synthesis. A 121-frame refinement completed in 43 seconds after face preparation, preserving 24 fps and the clean voice. Sampled lip detail was softer, so it is not selected as the default. Its files are in the guided speech trial's `lipsync-v1` folder. The reused renderer now reads frame rate and dimensions from its source and supports retaining untreated audio; the older defaults remain compatible.

```powershell
& data/avatar-runtime/muse-env/Scripts/python.exe -u src/core/video/limited_runtime.py --status output/alex-creator/renders/RENDER-ID/lipsync-v1/limits.json --ram-gb 10 --working-set-gb 3 --gpu-gb 5 -- apps/avatar-marketing/lipsync-local.py output/alex-creator/renders/RENDER-ID
```

No post was published. Rechecked on October 23: Metricool confirms Alex's connection, but its connector lacks a direct local-file upload tool and Computer Use reports no available browsers. Upload remains a separate handoff until an upload surface is available.

## Run

From the Signal checkout:

```powershell
node apps/avatar-marketing/cli.mjs status
node apps/avatar-marketing/cli.mjs research
node apps/avatar-marketing/cli.mjs prepare
node apps/avatar-marketing/cli.mjs voice-draft final-final-files
node --test apps/avatar-marketing/tests/*.test.mjs
```

`prepare` produces three script plans, per-line Qwen API graphs, identity graphs and voice settings. It does not submit GPU work, train a LoRA, approve quality or publish. It fingerprints the approved face and refuses to proceed if its bytes change. `voice-draft` explicitly uses installed Kokoro as an audition, with the existing CPU/RAM supervisor. Alex's approved production voice is the separate pinned Qwen Ryan profile; Kokoro is never substituted silently.

`status` reports the separate creator production profile and the older app preview independently. `npm run avatar:export -- <render-receipt.json> the-chair` prepares a captioned 1080x1920 review copy from a complete decoded talking take and approved voice. It preserves the recorded speech and uses exact script words with ASR timings. This is an upscale from the recorded native resolution; output review and publication remain separate.

`research` defaults to creator-wide research: everyday humor, routines, useful finds and style. Use `node apps/avatar-marketing/cli.mjs research campaign` for Lemonade buyer-problem research. Both save a research task list. Set `SIGNAL_TREND_SEARX_URL` to an existing loopback SearXNG service to fetch search candidates automatically. No endpoint is configured in this session. A browsing agent can execute the same task list through connected search/browser tools. Search snippets alone never qualify as current viral evidence.

For a local reaction preview, first open a Demo Studio session, then:

```powershell
node apps/avatar-marketing/cli.mjs studio-prepare
```

This imports the outfit reference and prepares a five-second, mouth-closed reaction shot using the existing supervised LTX adapter. Submission and polling use the returned `planId` with Demo Studio's `ltx.submit` and `ltx.poll`. The adapter preserves runtime holds. This is a silent reaction clip under voiceover, not a lip-synced presenter.

## Content modeling operator loop

1. Inspect the US 7-day Creative Center view and search Alex's audience-interest queries. Choose editorial, practical-value or commercial intent first; use the product campaign's buyer-problem queries for commercial slots. Inspect Creator Search Insights in the account when available. Find 10-20 candidates.
2. Watch five sources. Save the exact URL, creator, upload time, region, observation time and visible metrics in `sources.json`. Record unknown values as `null`. Record how the numbers were obtained. For paid ads, record spend/placement context where available and keep them separate from organic examples.
3. Collect five comparable recent posts from each shortlisted creator for a baseline. Re-observe promising posts after at least one hour. The implemented selection heuristic is >=10,000 views and >=3x that creator's median, publication within 14 days, direct/imported evidence no older than 48 hours, and a watched source. These are campaign heuristics, not TikTok rules or guaranteed predictors.
4. Deconstruct: opening image, spoken hook, tension/question, beat timings, evidence, reveal, payoff, loop, comment motivation. Save what is observed, not a guess inferred from a caption.
5. Make a modeling card: source mechanism -> why Alex's audience cares -> original twist -> evidence -> payoff. A product and sales CTA are optional; entertainment should work without either. For a commercial slot, add the specific audience problem, offer, relationship disclosure and verified demonstration. Change at least the script, visual execution and payoff. Do not download/repost the source or copy its exact script, likeness or soundtrack without rights.
6. Add the brief to `briefs.json` with `mode: modeled` and watched `sourceIds`. Keep `original-test` for unvalidated creative hypotheses. `prepare` rejects unwatched modeled sources and mismatches between the script and delivery lines.
7. Generate two or three hooks while keeping the payoff constant. Choose one reviewable experiment. For the first product campaign, capture real Lemonade behavior using fictional files. If the product behaves differently, change the script. Alex does not claim invented personal use or results.
8. Generate voice, review the performance, then time the visual shots to that approved audio. Render with the locked face/outfit and voice. Inspect consecutive frames, hands, mouth, source accuracy, caption timing and exact spoken words.
9. Review the final edit and TikTok disclosures. Publish through a separately authorized publishing flow. Save the live URL and receipt. No publishing or scheduling is enabled here.
10. At 24h, 72h and 7d record retention, shares/saves, returning viewers, follows per 1,000 views and comment themes. For commercial posts also record attributed visits, trials, purchases and the product campaign. Model the strongest mechanisms from your own results next.

The first three scripts are original tests. Current organic breakout evidence was unavailable in this run: web access did not expose playable recent TikToks with reliable metrics, and no browser was connected. The one saved Top Ads lead is explicitly unreviewed paid inspiration.

## Persistent identity

The user approved Alex's face and outfit specification. The generated outfit image is a review candidate. Do not replace the approved face when generating later content. Wardrobe is a separate reference; the voice is a separate versioned profile.

The supplied [Smallzero influencer tutorial](https://www.youtube.com/watch?v=QHw5UXLo74M) was inspected through its publisher description/chapter list, not fully transcribed or watched. Its relevant stages are base face, upscale, multi-angle dataset, captioning, then Ostris LoRA training. We downloaded the official ComfyUI Z-Image template and built an API graph from its actual nodes. The current approved face was generated with built-in image generation, not Z-Image.

Dataset target: 20-30 distinct approved images, varied angles and expressions, consistent identity. This count is a proposed starting point, not a tutorial claim. Keep a held-out set of angles/scenes out of training. Manually remove face drift, duplicated images and artifacts; write captions that distinguish identity from changeable clothing. Hash inputs and checkpoint; record the exact base model. A fixed seed alone is not an identity lock. Do not use the LoRA graph until `alex-presenter-v1.safetensors` exists and has passed held-out validation. No LoRA has been trained yet.

Joey Castkit supplies face/outfit separation and flat reference lighting. Shotcaller supplies the 16-part shot structure, identity, geometry, camera, physics, acting and audio locks. Its Seedance runtime/reference limits are not copied onto LTX.

## Persistent voice and natural performance

Approved production voice: Qwen3-TTS 1.7B CustomVoice, speaker Ryan, English, fixed seed and model revision. Each take includes a separate natural-language performance direction. The user approved the chair take's voice and delivery. The same speaker can ask, explain and use dry humor without selecting a new identity; new takes still need review for wording and performance.

Kokoro is installed and useful for fast local timing/wording drafts. Its fixed voice/speed controls do not provide the same documented instruction interface. Voicebox is an optional studio wrapping multiple engines, not a competing voice model; ComfyUI can perform the production synthesis directly. Never silently swap voice engines when a production render fails.

For a unique voice, Qwen's official VoiceDesign -> Base cloning workflow creates a reusable synthetic reference. Base cloning and CustomVoice are different inference paths. Do not promise CustomVoice-style per-line emotional instructions on the Base clone path. Test a reference bank or fine-tuning only if the stock speaker cannot meet the brief.

For longer-form qualification, listen to a 60-90 second script with a question, explanation, understated joke, numbers and CTA. Score natural cadence, phrase emphasis, same-speaker identity, pronunciation, exact words and joins. The versioned `voice.json` records the user's approval of the 14.56-second chair take, its WAV hash, speaker and model revision. That approval does not imply a 60-90 second consistency test has passed.

Sources: [Qwen official implementation](https://github.com/QwenLM/Qwen3-TTS), [Qwen ComfyUI nodes](https://github.com/DarioFT/ComfyUI-Qwen3-TTS), [Voicebox](https://docs.voicebox.sh/), [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M).

## Audio in ComfyUI

Room shots can declare a `roomAudioProfile`. Generation still receives the clean voice for lip synchronization. `export-review.mjs` then invokes `room-audio.py` for subtle short reflections, microphone filtering and quiet synthesized room ambience. The source master is never overwritten; processed audio has a separate hash and receipt. Sample count and alignment are checked. A volume-matched dry reference is included, and both versions respect the peak ceiling without flattening the voice dynamics. The first profile at `campaigns/alex-creator/room-audio.json` was rejected because it still sounded like an overlay. New guided shots therefore retain clean audio while audiovisual articulation is assessed; exports refuse rejected room profiles. This treatment is synthesized, not a recording of the depicted room. Room treatment cannot repair incorrect lip sync.

```powershell
& data/avatar-runtime/qwen-env/Scripts/python.exe apps/avatar-marketing/room-audio.py output/alex-creator/voice/the-chair/ryan-42.wav output/alex-creator/voice/the-chair/new-room-review --source-sha256 d70ccc0a9817c9c4447a185c1ac236d50a7cc97377287b3519cc27f0076e1f40
```

Three workflows have different jobs:

- `qwen3-custom-voice.json`: upstream UI example for speech synthesis. The per-brief `voice-line-*-api.json` files have Alex's chosen speaker and actual delivery instructions. They require the Qwen custom node and model; they are not installed or inference-tested here.
- `voice-overlay-api.json`: built-in LoadVideo -> GetVideoComponents plus LoadAudio -> CreateVideo -> SaveVideo. It preserves input frame rate and replaces the soundtrack. It does not animate lips. Use matched video/audio durations. Long videos use the streaming assembler below to avoid loading all frames into RAM.
- `ltx25-audio-to-video-official.json`: upstream Lightricks A2V template. It accepts audio and an optional starting image; its documented preprocessing freezes audio tokens and its output muxes the original trimmed waveform. Use the approved Alex scene reference, the exact voice segment, and visual direction. Review actual lip synchronization and identity before accepting a result.

The official A2V template is saved intact; its optional API key field must stay empty for local-only encoding. Inspect and pin custom-node dependencies in a separate ComfyUI environment before installing. Signal's existing built-in-only adapter intentionally does not execute these custom-node graphs. This change does not weaken that restriction.

## Longer videos

The supplied [LTX-2 tutorial](https://www.youtube.com/watch?v=x1IFKNmsOac) describes a 20-second synchronized clip and a roughly seven-minute RTX 5090 demonstration. Its publisher description and chapter list were retrieved. The exact author's workflow is now behind [Smallzero membership](https://smallzero.io/); it was not retrieved. The saved official LTX 2.5 A2V graph is an explicitly different, current implementation.

This workstation has an RTX 3080 with 10 GB VRAM. The older app preview adapter remains limited to 3-5 seconds. The separate production runner above accepts up to 20 seconds through the same supervised local runtime. Length and resolution must be qualified with real outputs; the tutorial's 5090 benchmark does not apply to this GPU. The managed bootstrap includes an audio encoder compatibility fix: float32 mel preprocessing is converted to the encoder's BF16 dtype at the neural network boundary. Installed ComfyUI files are not modified.

Make 60-180 second edits from short shots: write the complete narrative, generate coherent paragraph-sized voice takes, approve a continuous audio master, then split scenes at natural phrase boundaries. Keep the same canonical references every shot; do not recursively use only the last generated frame, which can accumulate identity drift. Render one GPU stage at a time. Re-anchor longer A2V shots to the face and wardrobe references, and carry the approved audio through unchanged. Use real screen recordings for product demonstrations.

`splitTimeline` prepares bounded provisional shot windows up to 10 minutes; actual durations must be replaced with measured narration timing. `assemble.mjs` accepts completed reviewed video clips, an approved voice profile and audio hash, normalizes portrait output to 1080x1920/24fps, streams the edit, keeps the approved narration, and fully decodes the result. It refuses changed assets or an edit that cuts speech. It has not been validated on a production avatar render yet.

```powershell
node apps/avatar-marketing/assemble.mjs path/to/reviewed-edit.json
```

Manifest fields: `title`, `voiceProfileId`, `voiceProfileHash`, `audio`, `audioSha256`, `qualityApproved: true`, and `clips` containing `path`, `start`, `duration`, `role` (`avatar`, `product`, `broll`) and `sha256`. Paths are relative to the manifest. Final playback approval remains separate from successful encoding/decoding.

## Current acceptance state

The five-second native 768x1344 tripod take `alex-2060a18a-f35b-4d50-b495-ab27146b9479` and room-audio-v2 treatment were approved on 2026-10-23: "Looks good; use this direction." The guided speech profile keeps 30 sampling steps and the guidance passes. The successful run took about 34 minutes, peaked at 6.20 GiB GPU usage, and retained at least 8.72 GiB available RAM. High-resolution production uses a 1 GiB resident working set with sequential GPU jobs; the RAM, VRAM and temperature safeguards remain active.

The first complete edit is specified in `campaigns/alex-creator/the-chair-edit.json`: approved 121-frame opening, 149 frames of an original photographic chair insert using fixed wide/detail cuts, and an 81-frame closing shot conditioned on the voice from 11.25 seconds. It preserves the continuous approved narration and room-v2 master. The chair insert is a generated still in a separate bedroom, with a wooden chair seen from the doorway beside a bed and wardrobe. The first same-background insert was rejected because it made Alex appear to disappear. Future object cutaways must establish a distinct location or motivated off-camera angle. This insert is not an animated LTX shot. No zoom or interpolation is added. The completed 14.625-second, 351-frame export is `output/alex-creator/exports/the-chair-edited-f28891ed-9a6d-4a1a-b2ab-97156ba5f82e/video.mp4`, with receipt, exact-script captions, contact sheet and posting text alongside it. Full decoding passed; the encoded soundtrack correlates 0.9999747 with the approved room master at zero offset. The closing render took 1,333.605 seconds and stayed within the existing resource safeguards. Final user playback review and upload remain outstanding; nothing was posted.

```powershell
node apps/avatar-marketing/export-edited-review.mjs campaigns/alex-creator/the-chair-edit.json
```

Run this after every referenced render receipt exists. The exporter checks source hashes, exact script, segment audio offsets and frame counts, and saves a fully decoded captioned review at 1080x1920. The native talking video is 768x1344; export dimensions do not imply native 1080p generation. It records source approvals separately and always leaves final quality approval and publication false. A five-second approval never becomes automatic approval of the complete edit.

- Approved face saved; outfit reference generated and saved.
- Three original pilot scripts and delivery notes prepared.
- Content modeling provenance, ranking, freshness and baseline logic tested.
- Official image, Qwen and LTX A2V templates saved; per-line voice and overlay API graphs prepared.
- Kokoro draft voice generated under the existing supervisor after the first attempt was held for low RAM. It is not the production voice.
- Qwen Ryan's first voice and delivery are user-approved; longer expressive consistency remains to be tested. The user created the TikTok account and Metricool reports Alex connected. No post has been published or scheduled by this pipeline.
- Remaining work: review and upload the completed first edit, connect accessible trend research, and capture product proof for commercial slots. The two other original scripts have not yet been rendered. A trained avatar LoRA does not yet exist and is not required unless measured identity consistency needs it.
