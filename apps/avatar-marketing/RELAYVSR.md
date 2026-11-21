# Low-resolution LTX and RelayVSR

Owner clarification, 2026-11-09: retain RelayVSR detail at 0.8. Correct eye consistency in the source generation before adding detail. The 0.4-detail diagnostic is discarded as a production candidate; do not use reduced detail to conceal source defects.

Latest review, 2026-11-09: the owner found the fast preview's eyes odd. Execution history proves RelayVSR ran, but the output is not accepted for eye quality. `automation.json` is restored to `guided_speech_high`; `guided_speech_relay` completed the controlled comparison, but took 827.246 seconds end to end for 3.042 seconds of footage and is not selected for fast production. This overrides the new-default description below.

This is an explicit experimental production path. It keeps the approved high-resolution profile and the disabled recurring worker intact. `relay_fast` generates at native 384x672 with the distilled eight-step model and omits the second LTX upscaling/refinement pass. `guided_speech_relay` uses the development model at the same smaller size with all 30-step guidance passes. RelayVSR then uses its matched native 2x INT8 model and Flash decoder to produce 768x1344. An export at 1080x1920 would still be a separate resize, not native 1080 generation.

The owned ComfyUI 0.34 LTX installation is unchanged. Relay runs in the separate `data/relayvsr-runtime/ComfyUI` checkout at commit `53986ff1e0f2b0d78dd28f6fff7b680f178d8cb6`, with an isolated dependency overlay for comfy-aimdo 0.6.0 and comfy-kitchen 0.2.41. Both weights are pinned to Comfy-Org/RelayVSR revision `ba556c9fab83606eb82285b7eb3a9375232744b6` and verified against published SHA-256 values. The downloader streams four-MiB blocks and supports partial downloads. Do not replace the old LTX environment to install this feature.

## Run

Use PowerShell from the Signal workspace. The normal activity window, game detection and owned-process supervisor still apply:

```powershell
& data/avatar-runtime/qwen-env/Scripts/python.exe -B apps/avatar-marketing/alex_generation_supervisor.py --workspace . -- node apps/avatar-marketing/ltx-relay-video.mjs campaigns/alex-creator/relay-benchmark.json output/alex-creator/relay-benchmark
```

For a specifically owner-requested one-off test outside the ordinary window, the supervisor accepts `--manual-window-minutes 60` before `--`. It expires, still checks games and process ownership, does not bypass a paused generation policy and does not change any scheduled task. Do not use this flag for unattended recurring production. The November 9 owner request to resume and try within resource limits authorizes this turn's one-off benchmark.

Standalone upscaling of an existing 24fps low-resolution clip:

```powershell
& data/avatar-runtime/qwen-env/Scripts/python.exe -B apps/avatar-marketing/alex_generation_supervisor.py --workspace . -- node apps/avatar-marketing/relayvsr.mjs input.mp4 output/alex-creator/upscaled-example
```

## Long-form manifests

The existing Alex operator retains `production.profile: guided_speech_high` after the owner rejected the fast candidate's eyes. `relay_fast` and `guided_speech_relay` remain explicit experiments. Each low-resolution talking shot is upscaled before the established room-audio, cutaway and captioned edit. Existing jobs freeze their original render profile on resume; mixed-profile receipts are held. Every new output still needs playback QC before publishing. The recurring worker remains disabled.

Use `relay-benchmark.json` as the shape of the input. Supply one `audio` path and its SHA-256, plus explicit `shots` with reference image, SHA-256, prompt, frame count and optional seed. Each shot covers 24-192 final frames at 24fps. Frame coverage must match the whole narration within 0.15 seconds. `excerpt: true` is only for deliberate short previews, such as the 73-frame benchmark. Each generated shot is trimmed to its exact planned frame count; latent rounding never moves subsequent narration offsets. The final edit encodes the original continuous narration once. Add captions after upscaling, using existing alignment/edit tools.

Completed LTX and Relay receipts are reusable. An interrupted submitted render is held for inspection instead of blindly generated again. Keep the same manifest and output folder to resume. To make a different creative version, use a new output folder. Check the log and failure receipt before explicitly retrying a failed shot.

Relay's native node materializes video frames in CPU memory. This wrapper bounds it to 90 core frames and 15 context frames at either edge, then discards the overlap. Chunks cover every source frame exactly once. Audio is stream-copied around standalone Relay and decoded PCM hashes must match. Long-form joins use the narration master, not concatenated per-shot audio. Check context boundaries visually: overlap is not a guarantee of invisible seams or identical generative detail.

## Resource and quality checks

LTX and Relay run sequentially under Windows Job Object commit limits of 12 and 10 GiB respectively, with two-GiB resident working-set limits, at least eight GiB available physical RAM and ten GiB available commit. Relay uses dynamic weight offload and a 512-MiB pinned-memory ceiling. The whole-GPU watchdog stops at seven GiB used, including unrelated apps; it is sampled and is not a hard allocation cap. Keep all safeguards enabled and never close the owner's apps to satisfy a benchmark.

Receipts record actual timing, dimensions, frame counts, model provenance and resource peaks. MP4 decoding and sharper textures do not establish good lip sync or identity. Watch eyes, mouth, hands, motion and chunk boundaries before approval. Super-resolution can add plausible detail; it cannot reliably repair an incorrect face or bad motion. Neither speed nor long-form visual quality is assumed from the paper's A100 results.

Sources: [ComfyUI native RelayVSR support](https://github.com/Comfy-Org/ComfyUI/pull/17511), [Comfy model files](https://huggingface.co/Comfy-Org/RelayVSR), [native 2x model](https://huggingface.co/lightx2v/RelayVSR_X2), [original implementation](https://github.com/kopperx/RelayVSR).

## Local qualification, November 9, 2026

The three-second, 73-frame Alex excerpt completed at 384x672 and was upscaled to 768x1344. LTX's recorded render time was 87.987 seconds; Relay plus its startup and assembly took 36.561 seconds. LTX startup is additional. Across the short test, peak whole-GPU usage was 5.876 GiB and minimum available system RAM was 8.760 GiB. The face comparison shows visibly clearer eyes, hair and clothing; sampled images do not certify natural lip sync in playback. `qualityApproved` remains false.

A separate load test repeated that base clip into a 60-second CFR fixture. Relay processed all 1,440 frames in 355.775 seconds across 16 bounded chunks. Peak whole-GPU usage was 2.651 GiB, peak job commit 5.857 GiB and minimum available RAM 12.970 GiB. Original and output decoded audio SHA-256 values matched exactly. This verifies duration handling and bounded memory; it is not a newly generated minute of original content or proof of seamless chunk boundaries.

Evidence: `output/alex-creator/relay-benchmark-2026-11-09/receipt.json`, `face-comparison.jpg`, and `output/alex-creator/relay-stress-60s/upscaled/receipt.json`. The existing editor adapter was exercised using the completed real render and its verified cached Relay output, without rerunning the GPU. Validation passed 24 Node tests, 17 Python guard tests, scoped ESLint and a real Windows allocation-denial check. A fully new long-form LTX sequence and a new captioned operator job are not yet qualified end to end. All owned renderers exited; the Windows recurring task was verified disabled.

## Guided eye comparison

The November 9 guided comparison used the same 384x672 source dimensions, reference, seed, audio and Relay detail 0.8. LTX render and verification took 779.329 seconds; LTX including startup took 790.018 seconds. Relay took 34.451 seconds. The fresh uninterrupted pipeline took 827.246 seconds (13m47s), or 271.971 wall seconds per output second. The LTX interval was 8.86 times the fast candidate's 87.987 seconds. Sampled eyes look more coherent in the guided source, but motion and identity remain unapproved. This cost is unsuitable for the requested fast path.

The current runtime also caps resident working memory at 2 GiB and reserves a 6 GiB GPU headroom target. Those conservative settings may increase model-transfer/paging cost; their individual timing impact has not been isolated. Do not remove resource safeguards or claim an unmeasured speedup. Candidate face correction research is in `campaigns/alex-creator/face-detailer-research.md`; no face detailer is installed or enabled.
