# Compact video representation experiment

Independent research prototype for testing relational supervision under Signal's existing Windows memory supervisor. This is not Sophontic's private training method, not an exact VideoREPA implementation, and not a commercial-quality video model.

[Research findings and next experiments](../../docs/marketing-research/geometric-density-video-research-2026-10-04.md).

[Geometry, scene renderer, InSpatio audit and footage sources](../../docs/marketing-research/geometry-scene-renderer-research-2026-10-04.md).

Latest priority: [SoL refinement process, fast-image research and actual RTX 3080 experiments](../../docs/marketing-research/fast-image-generation-research-2026-10-04.md). Executable image experiments live in `research/image_refinement`.

## Run locally

From the Signal repository root, use the installed creative runtime's Python. Dependencies already present for the recorded run: Torch 2.13.0+cu130, safetensors, Pillow and NumPy. No installation or model download is performed by these commands.

```powershell
$densityPython = "$env:APPDATA\signal\runtime\creative\comfy-owned-v1\python_embeded\python.exe"
& $densityPython -s src\core\video\limited_runtime.py --cpu-only --ram-gb 3 --working-set-gb 2 --status data\density-unit-limits.json -- research\video_density\test_density.py
& $densityPython -s src\core\video\limited_runtime.py --cpu-only --ram-gb 4 --working-set-gb 2 --status data\density-pilot-new-limits.json -- research\video_density\experiment.py --output data\video-density-pilot-new --steps 150 --seeds 3 --device cpu --max-seconds 600
& $densityPython -s src\core\video\limited_runtime.py --cpu-only --ram-gb 3 --working-set-gb 2 --status data\density-verify-new-limits.json -- research\video_density\verify_run.py data\video-density-pilot-new
```

Use a new output directory for each experiment; existing directories are refused. The outer supervisor can refuse startup if physical RAM or commit reserves would be violated. The completed run used CPU only. CUDA is experimental and has not been validated here; invoking the training file directly bypasses the memory supervisor.

## Experiment contract

`model.py` supplies a 24,027-parameter conditional flow predictor and owned procedural videos. Conditions are first frame, two motion controls, diffusion time and video time. `losses.py` compares spatial/adjacent-frame cosine relations, allowing different teacher/student channel widths. Teacher features are detached and pooled to 16 spatial tokens per frame.

`experiment.py` trains baseline/aligned/shuffled arms at identical initial weights and data/noise per seed. The proxy teacher is pooled clean RGB, not a pretrained understanding model. Alignment weight is fixed at 0.05 for the recorded run. Sixteen Euler steps generate evaluation clips. The three metrics for video output assess pixels, frame differences and changes caused by reversing motion. Feature spread is a diagnostic only.

The baseline receives the same clean-video information through its flow target. Training instances and evaluation instances use separate procedural seeds, but belong to one narrow family. Repeated experimentation against this evaluation seed turns it into validation; use a new sealed split for future claims. Compute is not matched merely by matching steps.

`test_density.py` checks invariance to orthogonal basis changes/positive scaling, teacher gradient isolation, noncollapsed target mismatch, invalid inputs, counterfactual construction and an actual backward pass. `verify_run.py` checks source/checkpoint hashes and paired initializations, reloads every model, reproduces CPU metrics, and adds trivial static/control-ignoring baselines.

Each run retains config, source hashes, checkpoint hashes, per-seed metrics, means/sample standard deviations, safe tensor checkpoints and seed-zero diagnostic PNG/GIF files. These tiny previews are scientific diagnostics, not product assets. No Signal production queue or provider configuration is changed.

## Recorded result

`data/video-density-pilot-20261004`: all nine models trained in 31.55 seconds. Supervisor peak job commit was 1.72 GiB. Six tests passed; nine checkpoints reproduced all metrics exactly. The aligned arm worsened mean pixel/temporal error, and every arm performed worse than trivial static baselines. The short pilot proves the code executes and saves reproducible models; it does not demonstrate a useful generator, compression, or Seedance parity.

Next work is baseline convergence and better motion-sensitive evaluation, followed by licensed real-video feature caching if the experiment earns that larger investment. See the research report for the staged plan and commercial constraints.

## Structured transport comparison

`transport_pilot.py` learns two coefficients controlling a fixed image translation
operator from the same first-frame/motion inputs. It gives the task's known
structure to the model. It is a restricted renderer baseline, not an equivalent
general-purpose generator. The stored first frame and hard-coded resampler are
part of the system even though they are not counted as learned parameters.

```powershell
& $densityPython -s src\core\video\limited_runtime.py --cpu-only --ram-gb 3 --working-set-gb 2 --status data\density-transport-new-limits.json -- research\video_density\transport_pilot.py --output data\video-transport-new
```

The recorded run `data/video-transport-pilot-20261004` learns useful translation,
including on a fresh evaluation seed. Three saved checkpoints reproduce metrics
and pass zero-motion identity checks. This does not test novel objects,
disocclusion, natural video, or high-resolution inference speed.

`inspatio_preflight.py` reads only a bounded safetensors header from a pinned
public checkpoint revision. It saves no weight payload and loads no GPU model.
The resulting weights-plus-KV estimate excludes activations, VAE and other
applications. It is not a memory-fit benchmark.

```powershell
& $densityPython -s research\video_density\inspatio_preflight.py --output data\research\inspatio-preflight-new.json
```
