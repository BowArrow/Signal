# Owner-video expression calibration: October 19, 2026

Review artifacts: `output/avatar-research/2026-10-19/casey-avatar-calibrated.mp4`
and `casey-calibrated-comparison.mp4` (previous Ditto left, calibrated right).
Both are six-second local previews. Owner acceptance remains pending.

Latest owner feedback: improved, but still too much visible teeth and the eyes
need to look into the camera. Preserving original upper-face pixels also retained
the recording's off-camera gaze. The next prepared experiment measures a closed
mouth anchor from the same 500 source frames, reduces mouth-expression amplitude,
and uses CineGen's existing local reference-eye renderer with appearance learned
from the original recording. Scripts: `avatar-refine-face.py`, the
`--relaxed-mouth` option in `avatar-ditto-smoke.py`, and `avatar-camera-gaze.mjs`.
The first launch was held by the existing memory supervisor because only
3.5-3.8 GiB of system RAM was available, below its 6 GiB reserve. The owner
authorized temporarily stopping the Ollama model server. After the graceful
unload remained in `Stopping...`, the identified Ollama server and its runner
were stopped. Ollama's server subsequently restarted automatically. The new
preview completed under the unchanged resource limits.

## Softer mouth and camera gaze follow-up

Artifacts: `casey-avatar-camera.mp4` and `casey-camera-comparison.mp4` in the
same ignored output directory. The comparison puts the previous calibrated
version on the left and the new version on the right.

- Measured lip opening in all 500 calibration frames; selected the 40 most
  closed frames and used their median expression as a rest anchor. Mouth
  keypoint amplitude is 0.68 relative to that anchor. Cheek animation remains
  calibrated, while the neural renderer still retains recorded upper-face pixels.
- Scanned 131 moments across the original recording for eye appearance and
  camera-facing references. CineGen's existing reference-eye renderer selected
  original second 206 (estimated yaw 0.02954 rad, pitch 0.05600 rad). It made
  bounded corrections in 145/150 frames, with blink/availability bypasses.
  This is estimated gaze targeting, not proof of perfect perceived eye contact.
- Eye correction changed no lower-face pixels before encoding. Its output audio
  packet hash matches the softer-mouth input exactly. Original voice file and
  neural checkpoints were not modified. The existing watermark-free crop remains.
- All 150 frames decoded; audio/video durations are exactly 6 seconds. The new
  measured mean lip-opening ratio is 0.15477 versus 0.21824 previously, about
  29% lower. A simple bright-inner-mouth-pixel proxy was nearly zero in both
  versions and is not useful as a teeth segmentation score for this dim footage.
- Four matched face-frame pairs and a comparison still were inspected. Mouth
  opening is reduced, and moustache/beard remain visible. Owner review of motion,
  likeness, teeth and eye contact is still required; `qualityApproved` is false.
- Rendering took 41.563 seconds, with peak PyTorch allocation 1,646,414,848 bytes.
  The supervisor reported at least 11,137,916,928 bytes available RAM during
  rendering. Measurement, rendering, full decode and review stages exited 0.

Reproduce after the existing calibration/voice feature stages:

```text
scripts/avatar-refine-face.py
scripts/avatar-ditto-smoke.py --stage render --name casey-avatar-relaxed --features-from casey-avatar-ditto --calibrated --relaxed-mouth
node scripts/avatar-camera-gaze.mjs
scripts/avatar-mouth-comparison.py --camera
scripts/avatar-review-refinement.py
```

Python inference stages use the existing `limited_runtime.py` supervisor;
measurement/review stages use its `--cpu-only` option. The gaze script imports
the existing CineGen reference-eye modules read-only and records their hashes.
It currently requires the adjacent CineGen checkout and its local gaze/landmark
assets; this is an evaluation adapter rather than a packaged standalone runtime.

The first Ditto test was more fluid but the owner rejected its eye appearance,
mouth motion and likeness. It was a pretrained model conditioned on Casey's
footage; no personalized neural-network training had occurred. The adapter also
overrode every expression coordinate, including eyes, despite the source-video
mode normally retaining eye motion.

## Calibration, not neural fine-tuning

`scripts/avatar-calibrate-motion.py` uses the existing 20-second, 25 fps cropped
reference from original recording seconds 80-100 and extracts its matching real
speech. It measures 500 source expression frames and generates predictions from
the same real audio. It fits a regularized per-coordinate gain and offset on the
first 375 frames (15 seconds), then checks the final 125 frames (5 seconds).
Gains are bounded to 0.5-1.25; output coordinates are limited to expanded observed
1st-99th percentile ranges. Eye coordinates are excluded from the reported error.

The held-out expression-coordinate RMSE decreased from 0.00564876 to 0.00346734.
This passed the limited development check. It does not measure visual likeness,
speech intelligibility, phoneme accuracy, natural movement, or generalization
across other recordings. No neural-network weights were updated. All calibration
data and resulting coefficients remain local.

Files under ignored `output/avatar-research/2026-10-19/` include:

- `casey-expression-calibration.json`: fitted parameters, source hashes and scores.
- `casey-expression-calibration-pairs.npz`: measured and predicted coordinates.
- `calibration-original-80-100.wav`: matching real speech.
- `calibration-original-features.npy` and `.json`: audio features and provenance.

## Eye and identity preservation

The calibrated renderer retains original eye-expression coordinates and original
upper-face pixels. Each frame's tracked eye line and eye-to-mouth distance define
a smooth transition into the generated lower face. Cheeks, mouth and jaw remain
rendered from the original appearance features; the upper face is taken directly
from the original frame. A per-frame check fails rendering if protected source
pixels differ before encoding. Lossy MP4 encoding can still change decoded pixel
values slightly.

This keeps the recorded gaze and blinks rather than attempting new eye animation.
It does not synthesize a completely new facial performance, and does not guarantee
that retained upper-face expression matches newly written dialogue. It addresses
the reported eye drift while permitting a bounded mouth/cheek/jaw test.

## Completed validation

- All 150 frames passed the protected upper-face pixel check with zero difference
  before encoding. Full output decode passed; video and audio are both exactly
  6.000 seconds at 25 fps, 1024 x 576.
- Sampled frames retain facial hair and show a less open mouth than the previous
  Ditto test. These observations do not establish naturalness or owner likeness.
- Calibration extraction/fitting took 76.078 seconds; the subsequent preview took
  41.406 seconds. Peak PyTorch allocated GPU memory during rendering was
  1,592,486,400 bytes. All supervised stages exited 0 and retained system reserves.
- MP4 SHA256:
  `49b5cf11d02af5fc6a9047defaae64a312d092a0813fdcbd2fa8873d32cb9bc8`.
- Neural checkpoints, original footage and cloned voice were not modified.
  `qualityApproved` remains false. This is still not a cleared commercial pipeline.

## Reproduce

Run from the repository root, using the already installed isolated runtime.
Run these stages sequentially under `src/core/video/limited_runtime.py`, with
the existing 10 GiB job commit cap, 5 GiB GPU cap and system reserves:

```text
scripts/avatar-calibrate-motion.py audio
scripts/avatar-calibrate-motion.py fit
scripts/avatar-ditto-smoke.py --stage render --name casey-avatar-calibrated --features-from casey-avatar-ditto --calibrated
scripts/avatar-mouth-comparison.py --calibrated
```

The renderer reuses the previous six-second cloned-audio feature cache after
checking its hashes. The clone itself is unchanged. Earlier preview files are
retained. See the preceding [Ditto setup](local-avatar-ditto-validation-2026-10-19.md)
for environment and model revisions, resource supervision and outstanding
commercial dependency restrictions.

## Personalized training remains separate

Ditto publishes a [training branch](https://github.com/antgroup/ditto-talkinghead/tree/train)
with preprocessing for synchronized 25 fps video and audio, followed by MotionDiT
training. Its documented environment uses an A100, and its small-data example is
a workflow demonstration rather than a quality guarantee. This workstation's
training memory requirement and the sufficiency of the four-minute owner video
have not been measured. Do not describe the current calibration as a completed
personalized model or promise that full fine-tuning will resolve likeness.
