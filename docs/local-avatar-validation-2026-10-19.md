# Local avatar validation: October 19, 2026

Latest experiment: [Ditto full-expression preview](local-avatar-ditto-validation-2026-10-19.md)
retains facial hair in sampled frames; owner motion-quality review remains pending.

## Owner feedback and mouth revision

Owner review of v1: voice and body movement are good; mouth movement is
unacceptable. Treat v1 as rejected for presenter use. Successful decode and
sampled still frames did not establish acceptable motion quality.

Further owner feedback: the mouth does not resemble Casey's, moves independently
of the rest of the face, and looks unnatural. The wider blend improved movement
but lost the moustache and beard. The next test must preserve facial-hair
appearance while animating a coordinated facial expression. Further widening of
the MuseTalk patch alone does not satisfy that requirement.

Two six-second revisions use the same synthesized audio and source frames:

- `casey-avatar-lowerface.mp4`: a wider, spatially stable lower-face blend.
- `casey-avatar-stable.mp4`: that blend plus symmetric face-box smoothing and
  VAE posterior means instead of per-frame random latent samples.
- `casey-mouth-comparison.mp4`: synchronized A/B/C close-ups with v1 on the left,
  wider blend in the middle, and the stabilized variant on the right. One audio
  track comes from v1; the comparison lasts six seconds.

The tight original blend can leave the original jaw articulation around newly
generated lips. This is a hypothesis for the unnatural movement, not a confirmed
root cause. The wider revisions visibly soften beard texture, so they are not
accepted fixes. Both decode successfully, contain 150 frames, and have audio/video
duration differences below one frame. No subjective lip-sync or cadence metric
is implied. Review remains pending; do not replace v1 with either automatically.

The renderer now accepts `--seconds 6 --blend lowerface` for the isolated blend
experiment, and additionally `--stabilize --latent mean` for the second variant.
`scripts/avatar-mouth-comparison.py` recreates the comparison and duration checks.
The first variant took 39.859 seconds and the second 43.578 seconds, including
model loading. Original audio and video assets remain unchanged.

Upstream reference: [MuseTalk inference implementation](https://github.com/TMElyralab/MuseTalk/blob/main/scripts/inference.py).
The upstream v1.5 path fixes bbox_shift at zero; the README's bbox_shift advice
is explicitly for v1.0 and was not blindly applied to these experiments.

## Initial preview

Generated a 15.28-second presenter preview locally on the RTX 3080 10 GB.
Chatterbox synthesizes new speech from Casey's reference voice; MuseTalk 1.5
animates the mouth in recorded footage. Existing head, eye and body movement
comes from the recording. This is a working preview, pending owner review of
voice likeness, cadence and lip-sync. It is not a production quality approval.

## Review assets

All private media is under the ignored `output/avatar-research/2026-10-19/`:

- `casey-avatar-v1.mp4`: final preview, 1024 x 576, 25 fps, 382 frames, H.264/AAC.
- `casey-voice-presenter.wav`: generated voice before final video loudness adjustment.
- `casey-voice-natural.wav` and `casey-voice-baseline.wav`: short comparison takes.
- `casey-avatar-v1-contact-sheet.jpg`: sampled visual inspection.
- `validation.json`: aggregate checks; per-output JSON files retain render receipts.
- `presenter-script.txt`: exact spoken script.

The original Camo recording is unchanged. The motion reference crops 1280 x 720
to 1024 x 576 at x=128, y=0, excluding the lower-right Camo watermark. No Camo
watermark appears in the inspected output frames. Source and output hashes are
recorded. No private recording was uploaded; inference used local model files
with `HF_HUB_OFFLINE=1` after downloading model weights.

## Tested runtime

Dependencies and model files are isolated in ignored `data/avatar-runtime/`.
Existing ComfyUI/LTX environments were not modified.

| Component | Tested version |
| --- | --- |
| Voice | Python 3.11, torch 2.6.0+cu124, Chatterbox 0.1.7 |
| Presenter | Python 3.10.22, torch 2.0.1+cu118, MuseTalk 1.5 |
| Presenter dependencies | mmcv 2.0.1, mmpose 1.1.0, mmdet 3.1.0, diffusers 0.30.2, transformers 4.39.2 |
| Chatterbox source | `5de7a54aa4e5e2baadb0182dde554908b48b85c2` |
| MuseTalk source | `0a89dec45a0192b824e3cf4daf96c239440c5ed8` |

`model-receipt.json` records downloaded model revisions and hashes.
`voice-requirements-tested.txt` and `muse-requirements-tested.txt` freeze the
environments. Both dependency checks and CUDA imports passed.

The renderer processes one frame at a time, loads UNet in half precision,
releases Whisper before rendering, and streams frames to FFmpeg. Face boxes
are computed per source frame. Source frames are paired one-to-one without
looping or reversal. A feathered mouth-only mask preserves more beard detail
than the initial jaw blend in the inspected control frames.

## Repeat the bounded test

Run from the repository root after the existing setup. These commands reuse
the prepared motion frames and coordinates. Change output names to retain
earlier takes. Current source material supports at most 20 seconds at offset 0.

```powershell
$env:HF_HUB_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:PYTHONIOENCODING = 'utf-8'

& .\data\avatar-runtime\voice-env\Scripts\python.exe -u src\core\video\limited_runtime.py --status output\avatar-research\2026-10-19\voice-repeat-limits.json --ram-gb 10 --working-set-gb 3 --gpu-gb 5 -- scripts\avatar-voice-smoke.py --take natural --script output\avatar-research\2026-10-19\presenter-script.txt --name casey-voice-repeat

& .\data\avatar-runtime\muse-env\Scripts\python.exe -u src\core\video\limited_runtime.py --status output\avatar-research\2026-10-19\avatar-repeat-limits.json --ram-gb 10 --working-set-gb 3 --gpu-gb 5 -- scripts\avatar-musetalk-smoke.py render --audio output\avatar-research\2026-10-19\casey-voice-repeat.wav --blend mouth --name casey-avatar-repeat
```

## Results and limits

- Full final video decoded successfully. Video duration 15.28 seconds; audio
  duration 15.273333 seconds, a difference below one frame. This checks duration,
  not perceptual lip-sync.
- Independent local transcription matched all three generated scripts exactly.
  Audio samples were finite and unclipped. These checks do not establish speaker
  similarity or natural cadence.
- Full-script voice generation took 35.766 seconds, with about 3.67 GiB peak
  PyTorch allocated GPU memory. Avatar rendering took 71.438 seconds, with about
  1.99 GiB peak PyTorch allocated GPU memory. These are single measured runs,
  excluding installation and reference preparation, not performance guarantees.
- Supervised rendering exited successfully and retained configured system
  reserves. Minimum available RAM during the final avatar run was about 6.92 GiB.
- Sampled frames retain the original head movement and beard detail. Full
  playback and owner listening review remain required. The assistant did not
  audibly assess voice likeness. Output remains `qualityApproved: false`.
- Final MP4 SHA256:
  `9ce8ee7c46368b7d0cd369929c661d49e00d18abf2484ce7678c840af71db3c0`.

This stage does not implement a dots MCP adapter, long-form timeline, publishing
or sales automation. The next integration should expose bounded voice/render/edit
jobs and reviewable artifacts after the presenter quality is accepted.

## Installed creative skills

Copied the supplied files unchanged into `C:\Users\cshor\.codex\skills\`, each
as its own folder containing `SKILL.md`: `motiondojo-v1`, `scenecraft-v1`,
`castkit-v1`, `shotcaller-v1`. Source/destination SHA256 values matched. These
skills become available on the next turn. Their provider-specific guidance does
not make the local pipeline depend on a cloud renderer; no cloud generation was
invoked for this test.
