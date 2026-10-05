# Compact image/refinement research

Continued development now lives in the dedicated [CineGen-Runtime project](../../../CineGen-Runtime/README.md), including representation-geometry mathematics, an isolated runtime and a resumable controlled training queue. This directory retains the original experiments and receipts.

[Source audit, findings and measured results](../../docs/marketing-research/fast-image-generation-research-2026-10-04.md).

This folder contains an independent tiny RGB correction model and reproducible local experiments. It is not SoL-Refiner training code or a finished video generator. NVIDIA sources are retained only as an inspection snapshot under `data/research/sol-refiner-20261004/source` and are not imported by the student.

Use the installed runtime, without modifying its dependencies:

```powershell
$refinementPython = "$env:APPDATA\signal\runtime\creative\comfy-owned-v1\python_embeded\python.exe"
& $refinementPython -s research/image_refinement/inspect_sol.py --output data/research/sol-inspection-new
& $refinementPython -s src/core/video/limited_runtime.py --ram-gb 5 --working-set-gb 2 --gpu-gb 3 --status data/sdxs-new-limits.json -- research/image_refinement/benchmark_sdxs.py --model data/research/models/sdxs-512-dreamshaper --output data/sdxs-new
& $refinementPython -s src/core/video/limited_runtime.py --ram-gb 4 --working-set-gb 2 --gpu-gb 3 --status data/refiner-new-limits.json -- research/image_refinement/refiner_pilot.py --steps 1500 --evaluation-seed 1100003 --output data/refiner-new
& $refinementPython -s src/core/video/limited_runtime.py --ram-gb 4 --working-set-gb 2 --gpu-gb 3 --status data/refiner-verify-new-limits.json -- research/image_refinement/verify_results.py --student data/compact-refiner-1500-20261004 --baseline data/sdxs-benchmark-20261004 --model data/research/models/sdxs-512-dreamshaper --output data/refiner-verification-new.json
```

Use fresh output paths. The SDXS benchmark requires the already-downloaded pinned safetensors; it cannot download missing weights or execute remote model code. Pin: `IDKiro/sdxs-512-dreamshaper@76f720262bb051da75666b22c902a78c8e16c763`. Upstream model terms apply. Local baseline generated twelve images at median 30.33 ms excluding text encoding/load/save.

The student pilot trains on owned synthetic circles/textures at 128px and times inference separately at 512px/720p. The 1500-step run fails the quality comparison against input and box filtering. Its roughly 3 ms 720p forward latency is only a throughput feasibility observation. Exact identity initialization, finite loss, gradient clipping, output checks and checkpoint reload are exercised during the real run. The verifier checks retained source/weight/image hashes and reevaluates the saved student independently. It does not approve visual quality or claim repeated identical wall-clock timings.

Training changes require fresh run paths and evaluation seeds; the recorded evaluation seed becomes validation once inspected. Training is bounded to 2000 steps/240 loop seconds. Windows job and PyTorch allocator limits apply only when run through the supervisor; no measured whole-device VRAM peak or renderer coexistence claim is made for these non-dynamic experiments.
