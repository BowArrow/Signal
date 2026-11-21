# Full-expression avatar test: October 19, 2026

Latest work: [calibration from Casey's recording](local-avatar-calibration-2026-10-19.md)
and preservation of recorded eye pixels. This page records the earlier rejected test.

Owner review rejected this first Ditto preview: eye appearance drifted, mouth
movements were strange, and the result did not look like Casey despite greater
fluidity. The adapter's all-expression override included eye coordinates and
contributed to the problem. Do not treat facial-hair retention as overall success.

Owner feedback established two failures in the MuseTalk previews: the generated
mouth did not look like Casey's and moved independently of the face. A wider
blend improved movement but erased moustache and beard detail. This test changes
the renderer to Ditto, using audio-driven expression coordinates with appearance
features extracted from Casey's original footage.

## Result

Private artifacts are in ignored `output/avatar-research/2026-10-19/`:

- `casey-avatar-ditto.mp4`: six-second full-frame test, 1024 x 576, 25 fps.
- `casey-ditto-comparison.mp4`: previous wider blend on the left; new test on the
  right. Both use the same six seconds of cloned speech and source footage.
- `casey-avatar-ditto-contact.jpg`: twelve sampled close-ups across the test.
- `casey-avatar-ditto.json`: generation receipt and hashes.
- `casey-ditto-comparison-validation.json`: comparison timing checks.

Sampled frames visibly retain the moustache and beard that the wider MuseTalk
blend lost. This observation does not establish natural motion, speaker likeness,
or perceptual lip-sync. Owner playback review is pending; `qualityApproved` remains
false. No posting or MCP integration was performed.

The cloned voice is unchanged: full-source WAV SHA256
`d8e0a8aa06df865d5d650f7e143afad624086dc2dec6f592b9f81f3f6587241d`.
The six-second input is trimmed from that WAV. The original recording and its
watermark-excluding reference crop remain unchanged. No personal footage or audio
was uploaded.

## Implementation

- Official [Ditto repository](https://github.com/antgroup/ditto-talkinghead), commit
  `c3e47eee2e626500017a0556b470d6d4182f85e8`.
- Official [PyTorch checkpoints](https://huggingface.co/digital-avatar/ditto-talkinghead),
  revision `e4a2f60328ee7c32af585ac4b3cce299e4c8e254`. All twelve selected files
  have size/hash receipts in `data/avatar-runtime/Ditto/checkpoints/download-receipt.json`.
- Isolated `data/avatar-runtime/ditto-env`: Python 3.11, torch 2.6.0+cu124,
  MediaPipe 0.10.21, ONNX Runtime 1.20.1, NumPy 1.26.4. CUDA/import and dependency
  checks passed; versions are frozen in `ditto-requirements-tested.txt`.
- `scripts/avatar-ditto-smoke.py` adapts the runtime without changing upstream
  files. CPU auxiliary models and two CPU threads per ONNX session; CUDA neural
  motion and face rendering. NumPy implements the upstream compositor's formula
  without requiring its Cython build on Windows.
- All 21 expression keypoints are driven together. Original per-frame head pose
  and body frames are retained. Packaged sample-person conditioning, prerecorded
  emotion arrays and pitch offsets are replaced with Casey's conditioning,
  neutral emotion and no added pitch offset.
- Source frames are paired one-to-one for all 150 frames. Appearance caches use
  float16; worker queues are limited to four items; conditioning avoids duplicating
  the source frames and appearance volumes.

## Resource and media checks

The first combined run stopped at the configured 6 GiB system RAM reserve. The
successful adaptation separates audio analysis and rendering into different
processes, releasing the large audio-analysis model before rendering. Memory
limits and reserves were not lowered.

| Check | Observed result |
| --- | --- |
| Audio analysis | 25.656 seconds; exited 0 |
| Registration and rendering | 38.515 seconds; exited 0 |
| Peak PyTorch allocated GPU memory | 1,649,548,288 bytes, about 1.54 GiB |
| Peak render job commit | 7,429,193,728 bytes |
| Minimum available RAM during render | 8,021,381,120 bytes, about 7.47 GiB |
| Full output decode | Passed |
| Output frames | 150 at 25 fps |
| Video/audio duration | Both 6.000 seconds |
| Final MP4 SHA256 | `1b748e2ebadcc6fd6b63c0f1454f8cc23a6d9836cf2c0794799296e2e2581a14` |

These are individual local measurements, not benchmark guarantees. Total time
excludes downloading and installation. Technical checks do not approve quality.

## Repeat

From the Signal repository root, run the stages sequentially:

```powershell
$env:HF_HUB_OFFLINE = '1'
$env:PYTHONIOENCODING = 'utf-8'
& .\data\avatar-runtime\ditto-env\Scripts\python.exe -u src/core/video/limited_runtime.py --status output/avatar-research/2026-10-19/ditto-audio-limits.json --ram-gb 10 --working-set-gb 3 --gpu-gb 5 -- scripts/avatar-ditto-smoke.py --stage audio
& .\data\avatar-runtime\ditto-env\Scripts\python.exe -u src/core/video/limited_runtime.py --status output/avatar-research/2026-10-19/ditto-render-limits.json --ram-gb 10 --working-set-gb 3 --gpu-gb 5 -- scripts/avatar-ditto-smoke.py --stage render
& .\data\avatar-runtime\ditto-env\Scripts\python.exe scripts/avatar-mouth-comparison.py --ditto
```

The feature cache checks source audio, duration and feature hashes before reuse.
Use matching `--name` values in both stages to retain earlier test outputs.

## Commercial integration remains unapproved

Ditto's repository declares Apache-2.0, but that does not automatically clear
every bundled dependency checkpoint. This configuration uses InsightFace
detection/landmark assets; [InsightFace's official terms](https://github.com/deepinsight/insightface#license)
distinguish MIT code from non-commercial pretrained models. This is a private
technical evaluation, not a cleared production sales-content pipeline. Replace
or separately license the affected dependencies and finish the model provenance
review before commercial integration. The receipt records
`commercialDependencyClearance: false`.
