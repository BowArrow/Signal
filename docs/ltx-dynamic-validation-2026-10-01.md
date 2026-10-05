# LTX dynamic loading validation, October 1

Status: source configuration corrected; three-second isolated preview completed
in the later retry 1790873870884. Full file decode and sampled-frame inspection
passed. Five-second app profile and packaged release remain unvalidated.
The owner subsequently rejected the visual quality as glitchy. It is not a
creative pass: consecutive frames show ghosting and the landscape crop cuts
off the upper face. A valid MP4 is not evidence of usable generated footage.
Installed Signal 0.53 has not been replaced with these changes. The LTX hold
and independent H3 incident hold remain in place.

Hardware observed: RTX 3080 10 GiB, 32 GiB system RAM. After the owner closed
Opera, initial free RAM was about 18 GiB. Model weights are retained locally.

## Changes

- Dynamic VRAM, two async offload streams, BF16 VAE, GPU text encoding and
  cudaMallocAsync replace the legacy H3 launch flags for LTX only.
- Initialize AIMDO before importing model_management: its host-buffer module
  captures the library handle during import. The former order produced a
  hostbuf_allocate error.
- Keep Windows commit capped at 16 GiB, working set at 4 GiB, and pinned staging
  at 1 GiB. Preserve 6 GiB free RAM and 8 GiB free commit. The sampled GPU
  watchdog stops below 1 GiB free VRAM or at 78 C; this is not a hard GPU cap.
- The LTX upscaler adapter constructs shapes on meta and then requires strict
  assignment of checkpoint tensors. This avoids allocating FP32 initialization
  weights and a second BF16 copy. No third-party installation files are edited.
- Latest experimental reserve-vram and extra dynamic vram-headroom are both
  3 GiB. They are targets; a complete run with them remains unverified.
- Failed smoke tests now save result.json and allow time for the limiter to
  record the worker exit.

## Evidence

Evidence directories below are in data/ltx-preview-validation/.

| Directory | Result |
| --- | --- |
| 1790869898374 | AIMDO import-order failure, corrected afterward. |
| 1790869968358 | Allocation failure with an experimental 8 GiB job cap. |
| 1790870046524 | With original 16 GiB cap, first 8-step sampling stage completed. Native access violation while constructing upscaler. No MP4. |
| 1790870452369 | With meta adapter, GPU watchdog stopped during text encoding before the upscaler could run. |
| 1790870517199 | Increased reserve-vram to 3 GiB; GPU watchdog stopped during text encoding. |
| 1790870568324 | Increased extra dynamic headroom to 3 GiB. Separate Ollama gemma4:e4b loaded about 10 GiB RAM; free RAM reached 5.89 GiB and the watchdog stopped the renderer before generation. |
| 1790873870884 | Ollama was unloaded. Both sampling stages, meta upscaler, decode and MP4 save completed. Prompt 95.25 s; submit-to-file 96.88 s. 73 frames, 24 fps, 512x256, 3.041667 s, H.264, silent. Whole-file FFmpeg decode passed; six sampled frames show nonblack image and gaze/smile changes. Opening crop cuts off upper face; not approved creative. |

Successful retry peak job commit: 13.17 GiB. Minimum free RAM: 6.34 GiB;
minimum free commit: 17.48 GiB. Peak device-wide GPU use: 7.94 GiB and peak
temperature: 57 C. The supervisor and worker were confirmed stopped afterward.
The last limits.json is a pre-shutdown sample; shutdown.json records the check.

The completed first stage in 1790870046524 took about 23 seconds. This is not
end-to-end render speed. Recorded peak job commit was 15.17 GiB. The upscaler's
temporary weight allocations are a plausible cause of its failure, not a
confirmed diagnosis. The GPU responded after exit; no new display-driver or
system-reset events were observed in that interval.

scripts/test-ltx-upscaler.py passed against all 72 tensors of the real checkpoint
under a 4 GiB CPU-only Windows job. It verifies exact key matching, BF16
parameters, no unmaterialized tensors, shared checkpoint storage, and rejection
of a non-assigning loader. It does not verify GPU inference.

Seven limiter integration tests, forty video tests, and TypeScript checking
passed after the changes. No browser was opened, user app closed, OS setting
changed, cloud credits spent, or campaign delivery performed by these tests.

## Remaining acceptance

1. Completed: run with the competing Ollama task idle and retain all safeguards.
2. Completed: both stages, upscale, decode, and MP4 save.
3. Completed: probe and decode the whole file; sampled-frame inspection. Full
   playback and creative approval remain separate from this technical test.
4. Test the five-second UI profile before enabling it. The diagnostic is only
   three seconds at a smaller landscape resolution.
5. Package and validate the new runtime assets, then install the release.

The separate two-to-four-minute community-content workflow is still pending.
It should compose directed clips with narration and useful researched material,
not request one multi-minute local generation.

Baseline reference: https://github.com/reventadirecta/LTX-2.5-I2V-8GB-VRAM
Its reported 4060 laptop result is not a measurement of this computer.

## Quality investigation

The retained reference is 900x1200 (3:4 portrait), but the initial diagnostic
forced it into 512x288 and its half-resolution latent rounded down to an
effective 512x256 output. The native conditioning node also center-crops to
latent dimensions. This loses the top of the head and creates a poor opening
composition. LTX recommends source and output aspects match:
https://docs.ltx.io/open-source-model/usage-guides/image-to-video

The VAE decoder used temporal_size=16 / temporal_overlap=4. Native ComfyUI
converts those to two latent frames per chunk with one frame overlap. The
upstream low-memory example uses 64 / 16 instead. Whether the short chunks
cause the observed double-image ghosting remains unconfirmed.

Prepared diagnostic variants in scripts/ltx-preview-smoke.ts:

- --variant=temporal retains the original source crop, prompt, seed and
  sampling settings and changes only temporal decode to 64 / 16.
- --variant=portrait uses 384x512 to match the original 3:4 image without
  cutting off the face. Other sampling settings stay unchanged.
- --variant=baseline retains the original configuration.

All variants export the conditioning image for inspection and retain the
same resource safeguards. No quality fix is claimed until the comparison
renders and consecutive-frame review are complete. Automatic rendering
remains held. Another Ollama model was using RAM during quality preparation;
the user was asked to pause it before further GPU tests.
