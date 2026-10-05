# Geometry, scene rendering and a fast neural appearance model

October 4, 2026. Follow-up to the [geometric-density research](geometric-density-video-research-2026-10-04.md), incorporating the owner's proposal to combine a scene/motion system with a model that paints detail, and the InSpatio-World 1.5 reference.

## Architecture decision

Make a persistent scene plus a compact appearance model the lead research direction for interactive generation. Keep LTX as a separate full-video baseline. This architecture has relevant published precedents and a clear way to reuse the GPU's rendering capabilities. Real-time Seedance 2.5 quality on this RTX 3080 remains a target to measure, not a demonstrated result.

The runtime should maintain scene identity, geometry, camera poses, visibility, object motion and reusable appearance memory. A renderer supplies a cheap image and auxiliary buffers. A learned model supplies a correction conditioned on these buffers and history. This lets us preserve already-known detail and concentrate computation on changing appearance and newly visible regions.

There are two distinct meanings of geometry here. Sophontic discusses internal representation structure; the renderer uses explicit spatial structure. They can be combined, but one is not evidence of the other's proprietary method.

## What the mathematics can contribute

### 1. Group actions and equivariance: encode transformations once

Suppose g is a camera or object transformation. An equivariant representation aims for `h(g x) = rho(g) h(x)`: transform the input and the representation changes in a predictable way. Invariance would remove that change entirely, which is inappropriate when the desired output must actually move. Equivariance can reduce how many separate examples a model needs to learn for the same object at different positions. [Geometric Deep Learning](https://arxiv.org/abs/2104.13478).

For rigid scenes, rotations and translations belong to SE(3). A pose can be updated through a six-dimensional twist and the matrix exponential rather than unconstrained independent matrix entries. The resulting rotation remains on SO(3). This is useful structure for a scene controller; it does not specify textures, lighting or unseen objects.

Our immediate restricted implementation uses 2D translations. With input image I0, motion control u, a 90-degree rotation J, and two learned scalars a,b:

```text
v = a u + b J u
I(t, x) = I0(x - t v)
```

The motion map commutes with planar rotations. Sampling a finite pixel grid introduces interpolation and boundary errors, so the complete raster operation is only an approximation to continuous equivariance. This restriction is deliberate and testable.

### 2. Transport equations: carry known detail instead of regenerating it

When appearance is conserved along a motion field v, the image satisfies the advection equation `dI/dt + v dot grad(I) = 0`. Following a trajectory transports existing appearance. Under constant velocity, the previous formula solves it directly. Real scenes also contain disocclusion, changing light, specular effects and deformation, so pure transport is insufficient.

A proposed hybrid decomposes the next image into transported history and a learned residual:

```text
history = reproject(previous_output, depth, camera, object_motion)
base = visibility * history + (1 - visibility) * coarse_render
output = base + appearance_model(buffers, base, scene_memory)
```

Visibility must come from depth/occlusion checks. Reprojecting through an occlusion boundary causes ghosting. New surfaces require generation or previously cached scene detail. Avoid repeatedly warping an already blurred image: retain stable reference views or a surface-associated appearance cache.

This decomposition is our proposal. Related work uses rendering buffers for learned photorealism enhancement and single-step neural rendering. [Enhancing Photorealism Enhancement](https://arxiv.org/abs/2105.04619), [RenderFlow](https://arxiv.org/abs/2601.06928).

### 3. Constraint manifolds: restrict the set of possible answers

A representation z can be constrained by camera projection, rigidity, identity persistence or known kinematics. Mathematically, a valid set might be `M = {z : c(z) = 0}`. Parameterizing valid states can be cheaper and more reliable than learning to penalize every invalid state. Soft penalties remain useful when observations or physics are approximate.

This gives a concrete interpretation of a geometric structure containing solutions: learn or construct a useful constrained family, then search or predict within it. It is not an identified explanation of Sophontic's phrase. A manifold can still be complicated, and finding it can cost more than it saves.

[Riemannian Flow Matching](https://arxiv.org/abs/2302.03660) provides a published way to train generative flows on manifolds. It does not mean arbitrary video frames live on a known simple manifold. We should first use known structures such as poses, orientations and normalized feature spaces, and benchmark against unconstrained alternatives.

### 4. Relations and object composition: preserve what changes together

A small model can represent objects and their interactions separately from raw pixels. Graphs express relationships and local influence; object slots provide one learned factorization. This could let the dynamics system update a few entities while the renderer carries detailed appearance. [Graph Network-based Simulators](https://arxiv.org/abs/2002.09405), [Slot Attention](https://arxiv.org/abs/2006.15055).

The open challenge is obtaining stable objects and relations from arbitrary reference footage. A supplied Unreal scene gives us this information directly. If a model must discover it, that cost and its mistakes belong in the system benchmark. The same applies to identifying causal variables: intervention tests are more informative than merely matching correlations. [Towards Causal Representation Learning](https://arxiv.org/abs/2102.11107).

### 5. Stable dynamics: constrain long rollouts

Hamiltonian models encode conservation structure through `dq/dt = dH/dp` and `dp/dt = -dH/dq`. They can be appropriate for conservative physical motion. General cinematic motion includes contact, friction, active agents and edits, so forcing all dynamics to conserve energy would be wrong. Use the appropriate mechanical structure per subsystem. [Hamiltonian Neural Networks](https://arxiv.org/abs/1906.01563).

For a learned latent transition F, stability matters as much as one-frame accuracy. Measure long-rollout drift, sensitivity to small input changes and return-to-view consistency. A contraction everywhere would erase distinct scenes; the aim is controlled error amplification while preserving meaningful state changes.

### 6. Intrinsic dimension and geometry measurements: test efficiency honestly

A task can need fewer effective degrees of freedom than the number of network parameters suggests. Work on intrinsic dimension studies optimization in lower-dimensional parameter subspaces; this does not automatically yield a smaller deployable model. [Intrinsic Dimension of Objective Landscapes](https://arxiv.org/abs/1804.08838).

For our experiments, measure singular-value spectra/effective rank of centered features, neighborhood preservation, relative motion relations, perturbation response and reconstruction quality at fixed memory. Effective rank alone is not a quality objective: a constant representation has very low dimension and no useful distinctions. Also account for scene assets, cached features and reference images. Moving information out of model weights is useful systems design, but it is not free information compression.

Priority order: transport and visibility first; explicit scene constraints second; relational supervision with controlled ablations third. Hyperbolic geometry or a new manifold-learning objective is a later experiment only if we identify a specific structure it represents better.

## InSpatio: what the reference establishes

The [World 1.5 page](https://inspatio.github.io/inspatio-world-1.5/) shows scene roaming and novel-view generation from images, image sets, panoramas and video. It provides a useful visual reference for spatial persistence. These curated examples are not a local hardware benchmark or a Seedance-quality comparison.

The associated [InSpatio-World paper](https://arxiv.org/abs/2604.07209) combines a spatiotemporal autoregressive model, implicit history, explicit spatial constraints and joint distribution-matching distillation. This is strong evidence that geometry plus a learned generator is a productive architecture family.

The paper's documented accelerated 1.3B configuration uses a tiny VAE and compilation, reporting 24 FPS on an H-series GPU and 10 FPS on an RTX 4090. Those figures belong to the reported configuration, not an independently verified World 1.5 result on our machine. [Implementation details](https://arxiv.org/html/2604.07209v2).

The related [WorldFM paper](https://arxiv.org/abs/2603.11911) uses 3D anchors and spatial memory for frame generation. Its evaluation reports about 25 FPS on H-series hardware and 10 FPS on an RTX 4090 at 512x512. Its limitations explicitly include dynamic content, restricted motion range and frame jitter. Those are directly relevant to the proposed neural appearance layer. [Evaluation and limitations](https://arxiv.org/html/2603.11911v3).

WorldFM's repository releases one/two-step models but notes that its internal scene-generation model is not included. Alternative scene initialization is therefore part of a reproduction. [WorldFM README](https://github.com/inspatio/worldfm).

### Actual World 1.5 code and checkpoint inspection

Pinned code revision: `dd3561f544053fe22d739b6b2f8461c9c97bf8cb`. Pinned checkpoint revision: `6a5cf5e27b8a05930911a5416fa8c68eabdda414`. Inspected source snapshots are under `data/research/inspatio-world-1.5-dd3561f/`; upstream license retained. We have not executed the upstream model.

The release uses a Wan-based generator and supplied/rendered source conditions. Its runner accepts existing depth. The README separates code licensing from dependency licensing. [Pinned README](https://github.com/inspatio/inspatio-world-v1.5/blob/dd3561f544053fe22d739b6b2f8461c9c97bf8cb/README.md).

The actual shape contract requires 832x480 output and three latent frames per block. Arbitrarily reducing resolution or block size to save memory is not supported by the current validation contract. The default config specifies four denoising steps. [Shape contract](https://github.com/inspatio/inspatio-world-v1.5/blob/dd3561f544053fe22d739b6b2f8461c9c97bf8cb/pipeline/scene_schema.py), [config](https://github.com/inspatio/inspatio-world-v1.5/blob/dd3561f544053fe22d739b6b2f8461c9c97bf8cb/configs/inference_1.3b.yaml).

The runner dynamically swaps the text encoder when GPU free memory is below 40 GiB, but puts the generator and VAE on GPU. That condition is not a 40 GiB minimum requirement. It also is not a complete generator offload system. CPU construction initially uses FP32 allocations, which matters on a machine constrained by Windows commit. [Runner](https://github.com/inspatio/inspatio-world-v1.5/blob/dd3561f544053fe22d739b6b2f8461c9c97bf8cb/inference.py), [model wrappers](https://github.com/inspatio/inspatio-world-v1.5/blob/dd3561f544053fe22d739b6b2f8461c9c97bf8cb/pipeline/wan_wrapper.py).

The bounded [metadata probe](../../research/video_density/inspatio_preflight.py) read 88,272 bytes of checkpoint header and no tensor payload into storage. It found 1,419,119,680 FP32 tensor elements, or 5,676,478,720 stored tensor bytes. BF16 residency for those tensors would be about 2.64 GiB. The pinned cache allocation at batch one is about 1.61 GiB:

```text
30 layers * 2 K/V * (1560 tokens * 3 latent frames * 2) * 1536 width * 2 bytes
= 1,725,235,200 bytes
```

The known sum is approximately 4.25 GiB before VAE, text encoder, activations, attention workspaces, driver/context, condition latents, renderer and desktop use. It is a reason to investigate fit, not a measured peak. [Cache source](https://github.com/inspatio/inspatio-world-v1.5/blob/dd3561f544053fe22d739b6b2f8461c9c97bf8cb/pipeline/causal_inference.py), [preflight receipt](../../data/research/inspatio-world-1.5-preflight.json).

Commercial detail: the default [DA3NESTED-GIANT-LARGE](https://huggingface.co/depth-anything/DA3NESTED-GIANT-LARGE) checkpoint is CC-BY-NC-4.0. Existing engine depth/camera buffers could remove that dependency. The World 1.5 weight repository at the inspected revision contains the weight file and Git attributes but no model card/license file; its weight terms remain unresolved. Apache licensing of inference code alone does not establish a commercial grant for every weight or dependency.

## Other references matching the owner's proposal

[REGEN](https://github.com/stefanos50/REGEN) is especially close: render a game frame, then apply a learned photorealism transformation. Its repository includes ONNX/Unreal integration instructions and reports demos on RTX 4090 and 4070 Super systems. It also notes temporal instability when its diffusion-produced training targets change appearances inconsistently. Its driving-domain results are not arbitrary cinematography, but it is a practical baseline family for a compact appearance model. [Paper](https://arxiv.org/abs/2508.17061).

[RenderFlow](https://arxiv.org/abs/2601.06928) proposes deterministic single-step rendering with optional sparse keyframe guidance. This motivates comparing a direct residual predictor against a one-step flow predictor, rather than assuming many diffusion steps are required for every frame.

[StreamDiffusion](https://arxiv.org/abs/2312.12491) demonstrates high image-generation throughput through batching and pipeline optimization. Its headline throughput is not automatically equivalent to input-to-display latency or temporally consistent video. We must record all three separately.

## Free footage and cinematic YouTube training

Yes, footage can support training and fine-tuning when acquisition and intended use are permitted. A public playback URL alone does not establish that. Prefer original files supplied by a rights holder or clearly licensed downloads rather than scraping.

| Source | Why it is useful | Selection rule |
| --- | --- | --- |
| Our own procedural scenes and footage | Exact cameras, motion, depth, material identities and paired renders. | Use owned or training-compatible assets; retain manifests. |
| [Poly Haven](https://docs.polyhaven.com/en/faq) | CC0 models, materials and lighting; its FAQ explicitly allows AI training. | Asset rights and API/download terms are separate. Useful for an owned scene dataset. |
| [Tears of Steel](https://mango.blender.org/about/) | Live-action/VFX film and production resources published under CC Attribution terms. | Retain attribution and verify the particular downloaded asset's terms. |
| [Blender Spring](https://studio.blender.org/projects/spring/pages/about/) | Cinematic animation under CC BY 4.0. | Useful for shot/lighting experiments; animation does not establish photoreal coverage. |
| [OSSL-v2](https://huggingface.co/datasets/McAuley-Lab/OSSL-v2) | Research dataset from public-domain films with film/source metadata. | Verify source work and jurisdiction, plus separate soundtrack rights if audio is used. Its original task is video-to-music. |
| Filmmakers' licensed source clips | Modern lenses, faces, camera movement and graded scenes. | Obtain permission covering model training and intended commercial use. |

YouTube provides a rights-holder setting for third-party AI training; it is off by default, and its help page says unauthorized downloading/scraping is prohibited. Eligibility also depends on applicable rights holders and platform terms. We should use authorized delivery and retain permission evidence for selected clips. [YouTube training policy](https://support.google.com/youtube/answer/15509945?hl=en).

Avoid interpreting a dataset's “open” name or top-level metadata as a universal commercial grant. For example, OpenVid-1M displays CC BY 4.0 metadata but its card says research/noncommercial use and directs users to source-dataset terms. It needs source-level resolution before inclusion in this commercial pipeline. [OpenVid-1M license section](https://huggingface.co/datasets/nkp37/OpenVid-1M#license).

Unreal's EULA distinguishes engine technology, separately licensed assets and rendered products. It also has explicit generative-AI and MetaHuman restrictions. Rendering permission is not by itself training permission for every asset. Begin with our own/CC0 assets and exclude MetaHuman or other restricted content from the training set unless the applicable terms expressly support the use. Blender offers an alternative rendering route for assets with suitable terms. [Unreal EULA, sections 1, 4 and 6](https://www.unrealengine.com/eula/unreal).

Start with a proposed 200-500 short, coherent shots for pipeline validation, not a claim of sufficient data for a foundation model. Separate by original scene/film/creator before extracting frames. Keep shot boundaries, camera metadata when available, blur/compression quality labels and duplicated-source checks. Hold out entire scenes so adjacent frames cannot leak across train/test. Unpaired cinematic videos alone do not supply ground-truth depth, motion or a matched cheap/high-quality render pair.

## A second experiment now completed

The [translation transport pilot](../../research/video_density/transport_pilot.py) implements the group-action formula above. It uses the same first-frame and motion inputs available to the tiny flow model, not hidden true positions or a privileged target scene state. Three seeded models trained for 150 steps each, learning two motion coefficients with a fixed bilinear resampler.

On the original comparison instances, mean future-pixel MSE was 0.000224, versus 0.16545 for the short flow baseline and 0.01705 for repeating the first frame. On a fresh evaluation seed chosen before this run, transport pixel MSE was 0.000173 and centroid-trajectory MSE was 0.000000125. All three checkpoints reproduce their fresh-evaluation metrics exactly; zero-motion identity checks pass. Training/evaluation/export took 0.81 seconds inside the script, excluding Python startup. Peak supervised job commit was about 1.72 GiB, CPU only. [Result](../../data/video-transport-pilot-20261004/result.json), [preview](../../data/video-transport-pilot-20261004/transport.gif).

This is a concrete demonstration of making a narrow task easier by encoding the correct structure. It is not a fair proof of general neural compression: the task is rigid translation, the flow baseline is undertrained, the resampler is hand-designed, and the first frame supplies all appearance detail. The system cannot invent unseen surfaces, change lighting, deform an object or generate arbitrary cinematic content. No high-resolution GPU speed was measured.

## Concrete runtime and training milestones

1. Export a deterministic scene sequence with RGB, linear depth, normals, motion vectors, object IDs, camera matrices and visibility masks. Use one owned environment and camera-only motion first. Coordinate units, matrix direction and motion-vector convention must be explicit.
2. Implement reprojection and visibility rejection; compare transported frames against the renderer's true views. Include return-to-camera loops and disocclusions. Establish where geometry succeeds and where the appearance model is needed.
3. Train a compact residual appearance model on matched cheap/high-quality render pairs. Condition on the renderer buffers and reprojected history. Compare direct convolutional prediction and one-step flow prediction; test temporal loss only where correspondences are valid. Initially freeze scene semantics so the painter cannot silently change identity or layout.
4. Add per-surface/reference appearance memory, then object motion and lighting changes. Introduce relational supervision only with baseline/shuffled controls and real improvement in held-out shots. Keep inference weights and memory small enough to coexist with the renderer.
5. Benchmark the complete warm loop on the 3080, including rendering, copies, neural inference and display/encoding. Record cold scene preparation separately. A 24 FPS target gives 41.7 ms per newly generated frame; 30 FPS gives 33.3 ms. These are budgets, not measured performance. Output-file FPS, frame interpolation and queued playback must not be reported as model generation FPS.

An initial illustrative 24 FPS budget is 8 ms rendering, 2 ms reprojection, 20 ms appearance inference, 5 ms output and 6.7 ms margin. Every number must be replaced by measurements. Require a stable total GPU operating target below 8 GiB, p95 latency, bounded memory across a long sequence, and blind quality review against selected reference shots. Offloading a large model every frame may meet capacity while failing this latency target; a compact resident appearance model is the preferred interactive design.

Current completion: mathematical research, source/metadata audit, two executable training experiments and recorded results. Follow-up [image/refinement research](fast-image-generation-research-2026-10-04.md) now adds measured SDXS generation and a tiny RGB refiner prototype on the RTX 3080; that prototype fails its quality comparison. An integrated neural painter, Unreal bridge, real-footage training and a real-time cinematic-quality demonstration are not yet implemented. The evidence supports pursuing the architecture; it does not yet support promising the final quality/speed combination.
