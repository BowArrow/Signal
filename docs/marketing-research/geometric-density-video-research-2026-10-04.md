# Geometric density and local video generation

Research and first experiment, October 4, 2026. Target: this PC's RTX 3080 10 GB, 32 GB RAM and Ryzen 7 5800X, with an 8 GiB whole-device operating target. Desired output quality: the owner's Seedance 2.5 reference. Quality parity has not been established.

## Decision

Pursue two separate workstreams: improve the existing LTX inference path, and test whether representation-based training helps a compact video student. A custom runtime can reduce memory residency and improve scheduling. Training must supply any missing visual capability; changing the runtime alone cannot supply it.

Sophontic's exact geometric-density method is not reproducible from the public material found. There are, however, published relational distillation and video representation-alignment methods we can use to formulate measurable experiments. The first independent experiment is now implemented and has actually trained nine tiny models locally. Its result is negative for overall generation quality. That does not refute Sophontic's unpublished method or the published video methods.

## What Sophontic means, and what is still unavailable

The company describes training internal model geometry to obtain compact reasoning models. Its homepage claims reasoning performance above models 60 times larger. Its about page refers to prototypes around 124 million parameters and very low relative training costs. These are company claims, not independently established outcomes for our workload. Neither parameter ratios nor reasoning results imply equivalent video quality. Sources: [homepage](https://sophontic.ai/), [about](https://sophontic.ai/about/).

Its model page says that model cards, evaluations and access details are forthcoming, and that the training recipe is withheld. I found no official released checkpoint, loss function, architecture specification, dataset recipe, training schedule or runnable reproduction sufficient to implement the exact method. This is a finding about the inspected public sources, not proof that no private method exists. [Model release page](https://sophontic.ai/models/).

The concrete public evaluation idea is paired reasoning: change one causally important fact and test whether the answer changes appropriately while both answers remain correct. The website illustrates this with ConvergeMini records. Its JavaScript renders embedded examples; these examples are not a live model inference endpoint. The site uses the term flip rate, but a reproducible benchmark still needs an unambiguous numerator, denominator, scoring code, complete results and contamination controls. Paired correctness is useful evidence of sensitivity to premises; by itself it cannot establish general reasoning. [Evaluation page](https://sophontic.ai/evals/), [site script inspected](https://sophontic.ai/script.js?v=20260808-seo1).

Research coverage included the official homepage, models, evaluations, about page, site script, linked interview and searches for a published technical recipe. The [linked interview](https://www.youtube.com/watch?v=4S8I22ybG2c) was discoverable, but a complete transcript was not retrievable in this session. I have not treated it as fully watched or transcribed. Third-party explanations, including proposed connections to epiplexity, cannot establish Sophontic's actual algorithm.

## A technical interpretation we can test

This section is our interpretation, not a reconstruction of the proprietary recipe.

For an input x, a network creates hidden vectors h(x). Their geometry includes which vectors are similar, the distances or angles between them, which directions preserve useful distinctions, and how representations change when an input changes. In video, those inputs can be patches across space and time. Teaching a small model useful relationships could make its limited capacity more productive.

“Density” alone does not define an optimization objective. Smaller distances can simply mean that all features collapsed together. Rotating a hidden representation and compensating in the next layer can preserve behavior while changing individual coordinates. Scaling can similarly change raw distance without adding capability. A useful objective therefore needs a defined representation, a defined relation measure, anti-collapse diagnostics and independent task evaluation.

Our prototype compares cosine relationship matrices within frames and across adjacent frames. If S and T are normalized student and teacher token features:

```text
spatial = mean_off_diagonal((S[t] S[t]^T - T[t] T[t]^T)^2)
temporal = mean((S[t+1] S[t]^T - T[t+1] T[t]^T)^2)
loss = flow_prediction_loss + lambda * (spatial + temporal) / 2
```

Channels may differ between student and teacher. Orthogonal basis changes and positive feature scaling preserve these cosine relations. Arbitrary invertible transformations need not. Spatial pooling limits the quadratic token-pair cost. The task loss remains necessary: matching a relationship matrix does not uniquely specify a correct generated video. Feature spread is recorded as a collapse diagnostic, not a measure of intelligence or compression.

## What reproducible research supports

| Method | Relevant evidence | What it does not establish |
| --- | --- | --- |
| [Relational Knowledge Distillation](https://arxiv.org/abs/1904.05068) | Transfers distance/angle relationships between examples to a student. | That Sophontic uses this method, or that video quality survives extreme compression. |
| [REPA](https://arxiv.org/abs/2410.06940) | Aligns diffusion hidden states with pretrained visual representations to improve image-model training. | Its reported training acceleration is not an equivalent parameter reduction or local inference speedup. |
| [VideoREPA](https://arxiv.org/abs/2505.23656) | Transfers spatial/temporal token relationships from a video understanding model into a video generator. Closest direct analogue for our research. | Smaller model size, Seedance parity, or an 8 GB training recipe. |
| [CREPA](https://arxiv.org/abs/2506.09229) | Cross-frame representation alignment during video-model fine-tuning; relevant to motion consistency. | That fine-tuning reduces the base model's inference weight memory. |
| [VICReg](https://arxiv.org/abs/2105.04906) | Variance/covariance regularization offers tools for avoiding uninformative feature collapse. | A standalone video generator or universal reasoning compression. |
| [Poincare embeddings](https://arxiv.org/abs/1705.08039) | Hyperbolic geometry can efficiently represent hierarchical relationships. | That changing embedding curvature alone yields a compact photorealistic video model. |
| [Epiplexity](https://arxiv.org/abs/2601.03220) | Studies learnable structural information under computational limits; relevant to selecting useful training data. | An identified implementation of Sophontic's geometric density. |
| [VDMini](https://arxiv.org/abs/2411.18375) | Content/motion-aware compression and distillation directly address smaller video models. | Transfer of the reported results to our model, GPU or reference clips without measurement. |
| [PARE](https://arxiv.org/abs/2605.27336) | Investigates architectural and sampling efficiency for video generation. | A verified ready-to-use replacement on this PC. |
| [Self Forcing](https://arxiv.org/abs/2506.08009) | Addresses the gap between autoregressive training and rollout behavior. | Automatic weight compression or immunity to accumulated temporal errors. |

One important negative result: VideoREPA reports that naive direct representation alignment can damage semantic adherence. Its relational method performs better in that comparison. Its documented experiments use eight A100 80 GB GPUs and batch size 32. We should borrow a testable principle while budgeting a different experiment, not claim to reproduce that training configuration locally. [Paper, experiments and ablations](https://arxiv.org/html/2505.23656v1), [official implementation](https://github.com/aHapBean/VideoREPA).

Parameter pruning, weight quantization, fewer denoising steps, activation checkpointing and representation supervision solve different problems. LoRA reduces trainable parameters and optimizer state; it does not remove the frozen base weights. Distilling fewer steps reduces repeated computation; it need not reduce model size. Quantization reduces bytes per weight but can lose visual quality. Each needs its own ablation.

## Why real-time games do not settle the generation question

A game renderer starts with a specified scene, geometry, materials, lighting and state. An unconstrained video model must infer plausible appearance, content and motion from much less information, often through repeated neural evaluations. The shared GPU hardware does not make those workloads equivalent.

The game analogy does suggest a useful restricted product: provide a known scene or reference image, explicit motion controls and a limited shot vocabulary, then learn a compact appearance or temporal refinement model. That reduces the unknowns. A specialized product-shot or environmental-motion model is a more testable first target than universal text-to-video. This is an engineering proposal, not a demonstrated quality result.

## Memory and runtime plan for this PC

GPU memory comprises resident weights, active-layer buffers, attention/other activations, temporary workspaces, VAE decoding and unrelated desktop applications. Host RAM and Windows commit are separate constraints. Weight streaming only addresses part of that sum.

The official LTX implementation already includes CPU/disk-to-GPU block streaming with reusable buffers. It is a candidate for a deeper adapter. It still needs compatibility checks against our exact quantized checkpoints and a measurement of transfer overhead on this PC. The current Signal diagnostic uses ComfyUI's dynamic loader, not a newly implemented native streamer. [LTX block streaming](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-core/src/ltx_core/block_streaming), [optimization guidance](https://github.com/Lightricks/LTX-2/blob/main/packages/ltx-pipelines/docs/optimization.md).

The already-added staged LTX test samples once, saves a hashed latent, exits the process, and decodes that same latent in fresh VAE-only processes with different temporal tiles. This isolates decoder artifacts from sampling and reduces concurrent residency. Portrait sampling is a separate controlled framing experiment. Whole-device supervision stops the owned job at 8 GiB sampled usage; a 250 ms watchdog cannot promise an instantaneous hard cap. See [runtime status](video-production.md).

Current evidence: an earlier LTX run completed 73 frames at 512x256 in 96.88 seconds, but its face ghosting/crop failed owner review. The new staged comparison was refused before loading because free Windows commit did not meet the sampler's 24 GiB startup requirement. No new improved clip is claimed. Source changes are not packaged production readiness.

For compact-student research, prepare teacher features and training latents in separate bounded jobs, unload the teacher, then train the student from disk caches. Avoid co-resident teacher/student/decoder execution. As an illustrative budget, one million parameters with FP32 weights, gradients and two Adam moments require about 16 MB before activations or framework overhead. A 100 million parameter student therefore already uses about 1.6 GB for those tensors; mixed precision and master copies can change the total. This arithmetic is a planning bound, not a fit guarantee.

Measure maximum device usage, Torch allocated/reserved bytes, peak process/job commit, available physical RAM, transfer time, load time, sampling time and decoding time separately. Reject a profile that meets VRAM limits only by exhausting host memory or spending unacceptable time paging. Preserve the current reserves and diagnostic holds while quality is unproven.

## Commercial pipeline constraints

PixelUMM's released weight licensing is noncommercial, making it unsuitable as the assumed foundation of this commercial pipeline. Check the exact selected artifact rather than inferring rights from the project page. [PixelUMM project](https://nv-tlabs.github.io/PixelUMM/).

The current LTX-2.x license defines derivatives broadly enough to include transfer through activations, outputs and synthetic-data distillation. Its royalty-free grant is conditional; entities with aggregated annual revenue of at least $10 million require a paid license for uses outside the defined noncommercial exception. Derivative redistribution carries license obligations. A distilled model is therefore not automatically independent of its teacher's terms. Pin the exact checkpoint's license and revision before training. [License dated August 11, 2026, sections 1.5, 2 and 3](https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x).

Treat the Seedance/OpenArt result as a quality reference. Possession of generated clips is not evidence of authorization to distill the provider's model. This pilot uses our own procedural examples and no external pretrained weights or provider outputs.

A production job should record model and adapter hashes, license revision, input provenance, seed, prompt/controls, dimensions, sampler, stage timings, memory peaks, output hash and quality-review status. Sampling/decoding should be restartable; cancellation must stop owned child processes. Queue only one GPU-heavy job. An OOM, incomplete decode or rejected clip must remain a failed/rejected job rather than a publishable result.

## What was implemented and actually run

Code: [research/video_density](../../research/video_density/README.md). Independently written conditional flow model, inspired by [flow matching](https://arxiv.org/abs/2210.02747), plus relational supervision. It is not a Sophontic or exact VideoREPA reproduction.

- 24,027 parameters; 8-frame, 16x16 RGB procedural moving blobs.
- Three arms: task loss only, task plus aligned relationships, task plus shuffled relationships.
- Three seeds per arm, 150 optimizer steps, same initialization/data/noise within each paired seed.
- Clean pooled RGB acts as a proxy teacher. It contains no learned semantic or physics knowledge.
- Unseen procedural instances for evaluation, including paired opposite-motion controls with the same first frame and sampling noise.
- Fixed step count, not equal compute: relation supervision adds work. Three training seeds and eight evaluation clips are too small for a general capability claim.

Run: `data/video-density-pilot-20261004/`. Nine models trained successfully in 31.55 seconds total on CPU, with no video-model download. Windows supervisor peak job commit was 1,846,534,144 bytes (1.72 GiB), under its 4 GiB ceiling. This is measured committed memory, not GPU usage or a physical-RAM measurement.

| Metric, lower is better | Baseline mean | Aligned mean | Shuffled mean |
| --- | ---: | ---: | ---: |
| Held-out flow velocity MSE | 0.43185 | 0.43300 | 0.41837 |
| Generated future pixel MSE | 0.16544 | 0.19230 | 0.19087 |
| Generated temporal-delta MSE | 0.19477 | 0.21995 | 0.22328 |
| Counterfactual-difference MSE | 0.03379 | 0.03352 | 0.03408 |

Aligned supervision worsened average pixel error by about 16.2% and temporal error by about 12.9%. Its small counterfactual improvement does not justify a success claim. Simply repeating the first frame scores 0.01705 pixel MSE and 0.00127 temporal-delta MSE; ignoring the motion control scores 0.03328 counterfactual-difference MSE. All trained arms remain poor on this short run. The saved preview also visibly contains residual noise. These metrics reward static backgrounds, so foreground/motion-specific evaluation is necessary before a larger experiment.

Validation: six mathematical/backpropagation tests passed. All nine checkpoint hashes and original source hashes match. Reloading every checkpoint reproduces every saved evaluation metric with zero absolute difference. `qualityApproved` is false. Checkpoints, source hashes, configuration, per-seed values, sample standard deviations and previews are retained. See [results](../../data/video-density-pilot-20261004/result.json), [verification](../../data/video-density-pilot-20261004/verification.json), [supervisor receipt](../../data/density-pilot-20261004-limits.json).

## Next experiments and decision gates

1. Establish that the synthetic baseline can learn useful motion. Use a dedicated validation split for tuning, a new sealed test split, foreground-weighted and centroid-trajectory metrics, and longer bounded training. Compare the same three arms across seeds. Do not tune repeatedly against the current test instances and call them untouched holdouts. Stop scaling alignment if it only improves its own auxiliary loss.
2. Build a small owned/licensed natural-video dataset with source-level train/validation/test separation. Cache video-understanding features and video latents separately, with teacher revision/license, source hash, timestamps, normalization and spatial/temporal mapping recorded. Begin with a restricted shot class and a compact student. Feature extraction throughput must be measured before choosing dataset size.
3. Compare task-only, feature regression, relational alignment and shuffled-relation controls. Match both optimizer steps and, in a separate comparison, wall-time/compute budget. Report quality versus parameter count, peak memory and latency. Test pruning or step distillation separately before combining them. A small adapter over a large base is not evidence of a small standalone generator.
4. Validate natural-video motion, identity, anatomy, prompt adherence and visual quality using fixed prompts, multiple seeds and blind reference comparisons. [VBench](https://arxiv.org/abs/2311.17982) offers useful evaluation dimensions, but metrics cannot replace owner review of the actual clips. Use a licensed reference set for Seedance-quality comparisons and disclose differences in duration/resolution.
5. Promote only after repeatable quality and memory results: completed jobs within the 8 GiB operating target, acceptable measured latency, correct aspect ratio, no observed identity ghosting, retained provenance and acceptable commercial terms. Until then the model remains a research artifact and the local production-quality gate stays closed.

The immediate deliverable is a working, bounded experimental foundation and a concrete inference diagnosis path. A tiny general-purpose model with Seedance-quality output is still an open research objective, not a result produced by this work.
