# Fast image generation and compact refinement: October 4, 2026

Target: RTX 3080 10 GiB, Ryzen 7 5800X, 32 GiB RAM; eventually a cinematic scene/motion renderer plus neural appearance model operating below an 8 GiB whole-device budget. The latest owner clarification prioritizes learning from SoL-Refiner's process to build a smaller model.

**Result:** local image generation at approximately 30 ms is now measured. A separate 103,488-parameter refinement prototype runs a 720p GPU forward pass in approximately 3 ms. Its quality experiment failed to beat simple filtering, so it is an executable speed baseline, not a finished cinematic refiner. SoL supplies useful training ideas but its released network is much too large to serve as our small resident model unchanged.

## What SoL actually teaches us

The paper's sequence is paired low/high-quality refinement training, perceptual reward post-training, then progressive three-step and one-step distillation. Initial pairs mainly come from degraded internal real videos; synthetic teacher pairs warm up training. Reward learning uses HPSv3++ and DeQA on sampled frames. DMD uses a student, frozen real-score teacher and trained fake-score model; the final stage adds an adversarial discriminator. This is substantially more training machinery than a single inference network. [Paper, sections 4.1-4.3](https://arxiv.org/html/2609.37969v1).

Its conditioned flow starts with `z1 = (1-s) z_low + s noise`, interpolates `zt = (1-t/s) z_high + (t/s) z1`, and learns velocity `(z1-z_high)/s`. A learned update can therefore repair an existing draft rather than invent every scene element. The paper's 2K refinement speedup is 57.461 to 6.447 seconds on H100, combining distillation, a tiny autoencoder and engine optimization. That is not an RTX 3080 latency measurement. [Paper, sections 4.1 and 5.2](https://arxiv.org/html/2609.37969v1).

Our interpretation: separate four independent levers: number of evaluations, network capacity, spatial/temporal token count, and memory/kernel overhead. Distilling steps does not automatically compress parameters. A much smaller student will need its own architecture, training and quality evaluation. Frame reward scores also cannot replace tests for identity preservation and temporal coherence.

## Source inspection, beyond the demos

Pinned Sana revision: `670482d8a857d578ac8a2ea89b052d0fb47badba`, branch `sol-engine`. Inspected the original LTX-2.3 pipeline, scheduler, attention routing, fusions and CLI, plus the separate MiniMax-H3 documentation. The inspected folder contains inference code and tests, not an executable complete three-stage training pipeline. [Pinned directory](https://github.com/NVlabs/Sana/tree/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner).

The original pipeline text-encodes the prompt, resizes/encodes the draft, doubles spatial latent resolution, normalizes, injects noise, predicts a correction, and decodes. The one-step package performs one conditional Transformer call; its concrete schedule is `0.725 -> 0`, distinct from rounded paper values. Multi-step uses 19 updates with two calls per uncached update for CFG. These checkpoints are separately trained. The Python path uses the full `AutoencoderKLLTX2Video`; the paper's tiny-autoencoder timings must not be assumed for this CLI. [Pipeline](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/sol_refiner/pipeline.py), [sampling](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/sol_refiner/sampling.py).

The engine orders spatiotemporal tokens along a Morton curve, routes selected attention blocks, retains dense boundary layers and text cross-attention, and fuses normalization/rotary/residual operations. Morton ordering groups nearby positions in memory; it does not encode a complete 3D scene. `--sol-density` controls attention-block retention, not Sophontic's claimed knowledge density or parameter compression. TeaCache reuses predictions across multiple denoising updates and is explicitly unavailable for one-step inference. [Attention routing](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/sol_refiner/sol_attention.py), [optimization](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/sol_refiner/optimization.py), [fusions](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/sol_refiner/fusion.py).

The CLI enables model CPU offload and tiled VAE decoding. Documentation targets Linux; specialized kernels select GPU architecture, with fallback paths. Existing Windows Diffusers 0.36.0 is not the pinned upstream LTX-2.3 API. The later H3 extension uses LTX-2.5 and a different decoder/checkpoint. No upstream environment or large refiner was installed into Signal. [Original instructions](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/README.md), [CLI](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/LTX-2.3/infer.py), [H3 extension](https://github.com/NVlabs/Sana/blob/670482d8a857d578ac8a2ea89b052d0fb47badba/models/sol-refiner/MiniMax-H3/README.md).

## Actual released weight footprint

Read metadata and shard indices at checkpoint revision `c69c2a543997fe12c1ae24c776df6188e5d2248a`; did not download tensor payloads. Sizes below include tiny file headers. These are storage sizes, not measured runtime peaks.

| Component | Stored weights |
| --- | ---: |
| Transformer | 35.370 GiB |
| Text encoder | 22.701 GiB |
| Connectors | 5.909 GiB |
| Latent upsampler | 0.927 GiB |
| VAE | 1.352 GiB |
| Total | 66.259 GiB |

The Transformer index gives 37,977,676,288 tensor bytes, corresponding to 18,988,838,144 BF16 elements. Even hypothetical ideal four-bit storage for that released Transformer alone is about 8.84 GiB, before scales, activations or renderer memory. This does not rule out pruning a different architecture; it rules out treating this checkpoint as already compact. [Model](https://huggingface.co/Efficient-Large-Model/SoL-Refiner-LTX-2.3-One-Step), [pinned metadata API](https://huggingface.co/api/models/Efficient-Large-Model/SoL-Refiner-LTX-2.3-One-Step/revision/c69c2a543997fe12c1ae24c776df6188e5d2248a?blobs=true), [local audit](../../data/research/sol-refiner-20261004/result.json).

Streaming/offload helps capacity but adds transfers. The lower bound is `transferred bytes / achieved transfer bandwidth`, on top of compute. We should offload occasional text/scene preparation, then keep the per-frame appearance network resident. The pinned weight tree lacks a model card/license file; resolve applicable upstream and derivative terms before using these weights or their outputs for commercial distillation. Code availability alone does not establish that grant.

## Image-generation and refinement candidates

| Candidate | Role and useful technique | Decision for this PC |
| --- | --- | --- |
| [SDXS DreamShaper](https://huggingface.co/IDKiro/sdxs-512-dreamshaper) | Small one-step text-to-image model, tiny decoder. Release explicitly trades diversity for quality. OpenRAIL++ terms. | Downloaded pinned public weights; local 512px baseline completed. Useful for fast drafts, not a demonstrated modern cinematic-quality endpoint. |
| [SANA-Sprint 0.6B](https://huggingface.co/Efficient-Large-Model/Sana_Sprint_0.6B_1024px) | 1-4 steps; compressed latent space and linear attention. Additional Gemma encoder/DC-AE components. Apache metadata plus Gemma terms; card also says research-intended. | Next compact general-image quality candidate. Full-system fit/speed on this PC remains unmeasured. |
| [NVIDIA Fixer](https://huggingface.co/nvidia/Fixer) | 0.6B single-step rendered-view artifact repair; DC-AE. Ampere supported, Linux preferred. Commercial/noncommercial use under NVIDIA model terms. | Closely matches the renderer/refiner interface. Driving/reconstruction training domain does not establish cinematic generality. Card reports 26.5 ms H100, 50.6 ms A100, 87.8 ms L40, not 3080 results. |
| [PiD](https://research.nvidia.com/labs/sil/projects/pid/) | Learned pixel-diffusion decoding/upscaling. | Study decoder quality/speed tradeoff; its advertised 2K example uses 13 GB peak VRAM on RTX 5090, beyond our operating budget. |
| [TinyFusion](https://arxiv.org/abs/2412.01199) | Learn which Transformer layers can be removed and recovered by fine-tuning. | Useful if a trained teacher/student still has excessive depth. Parameter pruning needs quality recovery; it is not accomplished by changing runtime settings. |

[SDXS research](https://arxiv.org/abs/2403.16627) combines architecture miniaturization with step distillation and feature matching. Its headline research models/decoder differ from the community DreamShaper release, so our measured result is the relevant local number.

[SANA-Sprint's paper](https://arxiv.org/html/2503.09641v1) combines consistency distillation and latent adversarial learning. Its 0.03-second figure is Transformer-only timing; end-to-end 1024px text-to-image is reported as 0.1 seconds H100 and 0.31 seconds RTX 4090. It uses a pretrained teacher and substantial training resources. Neither 0.6B parameters nor one-step inference establishes inexpensive from-scratch training.

[DMD2](https://github.com/tianweiy/DMD2) is a useful released training reference for distribution matching and adversarial supervision. Keeping teacher, student, score model, gradients and optimizer state in memory is a different problem from deploying one student. Our first local training route should use stored targets/features, not assume full online DMD fits alongside a scene renderer.

## What ran locally

SDXS used FP16, one step, guidance zero, batch one, two warmups, three prompts and four seeds each. Median cached-prompt-to-PIL latency was **30.33 ms**, p95 **31.82 ms**; separately measured prompt encoding took 6.96-8.22 ms. Peak PyTorch allocation was **1.000 GiB**, reserved **1.074 GiB**. Loading took 2.54 seconds after imports. No compilation or offload was needed. GPU synchronization brackets each sample; disk saving is excluded. [Receipt](../../data/sdxs-benchmark-20261004/result.json), [all 12 images](../../data/sdxs-benchmark-20261004/contact-sheet.jpg).

Visual inspection: recognizable lighthouse/waves, raincoat portraits and stone streets; similar compositions across seeds, stylized/overprocessed details. These are independent stills. There is no temporal conditioning, external-reference match or Seedance comparison. Twelve samples establish a smoke benchmark, not a robust long-session latency distribution.

The independent compact student has **103,488 parameters**, about **0.20 MiB FP16 weights**. It rearranges 4x4 pixel neighborhoods into channels, processes a smaller grid with residual/depthwise convolutional blocks, then predicts an RGB correction. It initializes as an exact identity function. No text encoder, VAE, diffusion schedule, NVIDIA weights or temporal state are in this model.

| Student test | 512x512 | 1280x720 |
| --- | ---: | ---: |
| GPU-forward median | 1.26 ms | 3.03 ms |
| GPU-forward p95 | 1.75 ms | 4.63 ms |
| CPU uint8 input to CPU uint8 output median | 2.38 ms | 5.60 ms |
| CPU uint8 input to CPU uint8 output p95 | 3.17 ms | 7.50 ms |
| Peak PyTorch allocation | 16.9 MiB | 50.9 MiB |

Thirty synchronized batch-one samples per resolution follow eight warmups. FP16 eager execution, no compilation. Transfer measurements include upload, conversion, prediction and download, excluding rendering/display/file writing. Timing inputs are random pixels; that measures speed, not high-resolution quality. [Receipt](../../data/compact-refiner-1500-20261004/result.json).

Independent verification passed: all twelve image hashes, three generator weight hashes, student checkpoint/source hashes, and a fresh checkpoint evaluation. All three recorded student metrics reproduced with zero difference. [Verification receipt](../../data/image-refinement-verification-20261004.json).

**Quality outcome is negative.** A 180-step initial test produced a small gain. Extending training to 1,500 steps and adding a fixed-filter baseline/fresh evaluation seed exposed failure: on 16 held-out 128px procedural images, the input scored 29.19 dB PSNR, the student 28.45 dB, and a fixed 3x3 box filter 30.75 dB. Student edge error also worsened. Training took 17.06 seconds inside the loop; checkpoint reload reproduced predictions exactly. The preview shows patterned residual errors. The architecture/loss needs revision before any cinematic-data claim. Do not select a model on training loss or speed alone. [Draft/student/target comparison](../../data/compact-refiner-1500-20261004/draft-student-target.png).

Both experiments ran inside the existing Windows supervisor: 3 GiB PyTorch allocator budget, 2 GiB working-set limit, 5 GiB job commit for SDXS and 4 GiB for the student, with 6/8 GiB system RAM/commit reserves. SDXS peak job commit was 4.80 GiB; student 3.01 GiB. These non-dynamic runs do not record an NVML whole-device peak; PyTorch allocations exclude driver and other applications. We have not yet verified renderer coexistence or the whole-device 8 GiB target.

## A practical small-model training design

Our proposed task is conditional appearance refinement: scene geometry, camera and motion already constrain most output pixels. This reduces what the neural model must invent. That is a testable structural advantage, not a proof that arbitrarily complex image distributions fit a tiny network.

Use the following decomposition for the next model:

```text
Optional text/reference model -> appearance keyframes or surface references
Scene renderer -> draft RGB + depth + normals + motion + visibility
Previous refined frame -> geometry-based reprojection -> valid history
Small resident student(draft, buffers, valid history, appearance reference)
    -> refined frame -> output and bounded history
```

A residual form is `output_t = draft_t + correction_theta(conditions_t)`. Reprojected history supplies known detail; validity masks reject disocclusions and changed objects. A separate path must synthesize newly visible detail. Stable per-surface conditioning/noise is preferable to independently resampling every frame. The first image generator's latency therefore need not dictate steady-state FPS if it supplies occasional keyframes.

Proposed progression:

1. **Fix the small-image baseline.** Compare translation-equivariant convolutional students against pixel packing; test one-pixel shifts and phase/checkerboard artifacts. Match losses to held-out pixel, edge and perceptual measurements. Require beating identity, interpolation and fixed filtering on unseen scenes. The present prototype fails this gate.
2. **Build matched training pairs.** Start with owned or CC0 scenes, cheap renders and matched high-quality renders at identical cameras. Include defocus, thin geometry, speculars, text, skin and occlusion boundaries as coverage grows. A folder of unpaired cinematic videos is insufficient supervision for this exact mapping. Keep scene/film identities separated before frame extraction.
3. **Train small capacity variants.** Proposed 1M/5M/20M parameter students, fixed-resolution patch batches and measured memory. Use pixel/edge losses first, then frozen perceptual features cached offline. The smallest successful architecture wins; weight size alone is not the criterion. Patch training may fit this PC while high-resolution activations do not.
4. **Transfer appearance knowledge.** Store licensed teacher-refined targets or features in a separate preparation job. Train the student without keeping that teacher resident. This supervised transfer is not exact DMD and may lose diversity/detail. Compare a deterministic residual student with a small one-step conditional-flow student before adding GAN/reward complexity.
5. **Train and evaluate temporal behavior.** Add masked reprojection error, identity/structure preservation and multi-frame unrolled training. Avoid rewarding temporal sameness on moving or newly visible content. Compare current-frame-only, history-conditioned and geometry-conditioned versions at the same compute budget.
6. **Optimize the selected model.** FP16, measured channels-last layout, then fused/compiled kernels or an export runtime if it improves p95. Quantize only after establishing a quality reference. Bounded buffers and GPU-local transfers matter. Changing runtime cannot supply missing learned priors.

For serial execution, `frame_time = render + reprojection + refinement + transfers + output`. A 24 FPS goal allows 41.7 ms; 30 FPS allows 33.3 ms. The measured 3 ms toy pass leaves a plausible research budget for a larger student, but does not predict its quality or the full loop's speed. Offline preparation, per-frame latency, throughput and video playback FPS must be reported separately.

Commercial training-source options and InSpatio's separate architecture audit are in the [geometry/renderer report](geometry-scene-renderer-research-2026-10-04.md). Sophontic's undisclosed method and our negative relational-supervision experiment are in the [geometric-density report](geometric-density-video-research-2026-10-04.md). No cinematic training set was scraped or purchased, no paid compute was started, and no production provider was replaced. The current deliverables are source inspection, retained real image generations, an executable student experiment, measurements and the next quality gates.
