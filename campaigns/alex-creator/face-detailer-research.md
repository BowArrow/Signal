# Face correction before RelayVSR

Owner direction, November 9, 2026: preserve RelayVSR detail 0.8 and correct unstable eyes before upscaling. A face detailer is a candidate, not an installed or validated solution.

Proposed experiment: reuse the exact fast LTX clip, track Alex's face across a short sequence, correct only the face/eye region with temporal conditioning and the approved identity reference, composite with feathered masks, then run the unchanged RelayVSR stage. Preserve natural blinks, gaze shifts, expression and the original audio-conditioned mouth. Do not paste a static eye texture or force eyes open. First assess corrected source frames and motion before assessing VSR output.

ComfyUI Impact Pack's standard FaceDetailer processes individual frames and explicitly warns that it is not designed for video. Its upstream recommendation is Detailer for AnimateDiff. The SEGSDetailerForAnimateDiff implementation accepts image sequences and masks spanning multiple frames. This is the best verified ComfyUI starting point from this research; it requires a compatible temporal model and additional runtime/model qualification. Merely placing an image checkpoint in a batch does not establish temporal consistency. No speed, identity or eye-stability result has been measured locally for this option.

Sources:
- https://github.com/comfyorg/comfyui-impact-pack/blob/Main/modules/impact/impact_pack.py
- https://github.com/comfyorg/comfyui-impact-pack/blob/Main/modules/impact/animatediff_nodes.py
- https://github.com/comfyorg/comfyui-impact-pack

KEEP is a video-specific face restoration research alternative, but its S-Lab license permits noncommercial use and directs commercial users to contact the contributors. It is not selected as the default for this marketing pipeline. SVFR is another video face restoration research implementation; its runtime footprint, dependencies and deployment suitability have not been qualified here. A search listing for ComfyUI-Temporal-Face-Detailer was not enough to verify that extension: its linked upstream repository returned 404 during this check.

Sources:
- https://github.com/jnjaby/KEEP
- https://github.com/jnjaby/KEEP/blob/main/LICENSE
- https://github.com/wangzhiyaoo/SVFR

Run any future face stage sequentially between unloaded LTX and Relay models, under the existing resource supervisor. Record face-stage elapsed time separately. Acceptance needs full-motion playback against the unmodified fast source: identity, iris/pupil shape, eyelids, blink timing, mouth sync, mask edges and temporal flicker. A sharp still is not acceptance. No face-detailer stage is currently enabled in production.
