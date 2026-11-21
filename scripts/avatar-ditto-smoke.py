"""Bounded full-expression Ditto evaluation using the owner's unchanged voice."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pickle
import random
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'data/avatar-runtime/Ditto'
OUT = ROOT / 'output/avatar-research/2026-10-19'
BIN = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--name', default='casey-avatar-ditto')
    p.add_argument('--seconds', type=int, choices=range(1, 7), default=6)
    p.add_argument('--stage', choices=['audio', 'render'], default='render')
    p.add_argument('--features-from')
    p.add_argument('--calibrated', action='store_true')
    p.add_argument('--relaxed-mouth', action='store_true')
    args = p.parse_args()
    if args.relaxed_mouth and not args.calibrated:
        p.error('--relaxed-mouth requires --calibrated')
    if not args.name.replace('-', '').replace('_', '').isalnum():
        raise ValueError('Use a simple output name.')
    if args.features_from and not args.features_from.replace('-', '').replace('_', '').isalnum():
        raise ValueError('Use a simple feature source name.')
    os.environ['IMAGEIO_FFMPEG_EXE'] = str(BIN / 'ffmpeg.exe')
    os.environ['HF_HUB_OFFLINE'] = '1'
    sys.path.insert(0, str(RUNTIME))
    os.chdir(RUNTIME)
    import numpy as np
    import librosa
    import onnxruntime as ort
    np.random.seed(42)
    random.seed(42)
    # Auxiliary landmark/audio ONNX models stay on CPU; reserve GPU for neural
    # motion and rendering. Bound per-session CPU thread pools as well.
    original_session = ort.InferenceSession
    def bounded_session(*pos, **kwargs):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        kwargs.setdefault('sess_options', opts)
        kwargs['providers'] = ['CPUExecutionProvider']
        return original_session(*pos, **kwargs)
    ort.InferenceSession = bounded_session
    voice = OUT / 'casey-voice-presenter.wav'
    feature_name = args.features_from or args.name
    audio = OUT / f'{feature_name}-input.wav'
    feature_path = OUT / f'{feature_name}-features.npy'
    feature_receipt = feature_path.with_suffix('.json')
    if args.stage == 'audio':
        from core.atomic_components.wav2feat import Wav2Feat
        start = time.monotonic()
        subprocess.run([str(BIN / 'ffmpeg.exe'), '-v', 'error', '-y', '-i', str(voice),
                        '-t', str(args.seconds), '-c:a', 'pcm_s16le', str(audio)], check=True)
        print('Extracting bounded audio features on CPU', flush=True)
        extractor = Wav2Feat({'model_path': str(RUNTIME / 'checkpoints/ditto_pytorch/aux_models/hubert_streaming_fix_kv.onnx'),
                             'device': 'cpu', 'force_ori_type': True})
        samples, _ = librosa.load(str(audio), sr=16000)
        features = extractor.wav2feat(samples)
        if features.shape != (args.seconds * 25, 1024) or not np.isfinite(features).all():
            raise RuntimeError('Invalid audio features')
        np.save(feature_path, features, allow_pickle=False)
        receipt = {'voiceSha256': digest(voice), 'audioSha256': digest(audio), 'seconds': args.seconds,
                   'featureSha256': digest(feature_path), 'elapsedSeconds': time.monotonic() - start}
        feature_receipt.write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt), flush=True)
        return
    saved_features = json.loads(feature_receipt.read_text())
    if saved_features['voiceSha256'] != digest(voice) or saved_features['audioSha256'] != digest(audio) or saved_features['seconds'] != args.seconds or saved_features['featureSha256'] != digest(feature_path):
        raise RuntimeError('Audio features are stale; run the audio stage again')
    features = np.load(feature_path, allow_pickle=False)
    import torch
    torch.set_num_threads(2)
    torch.manual_seed(42)
    # The upstream Cython compositor requires a Linux-oriented build. Use its
    # equivalent array expression without compiling or modifying the checkout.
    blend_module = types.ModuleType('core.utils.blend')
    def blend_images(mask, generated, original, result):
        alpha = mask[..., None]
        result[:] = np.clip(alpha * generated + (1 - alpha) * original, 0, 255).astype(np.uint8)
    blend_module.blend_images_cy = blend_images
    sys.modules['core.utils.blend'] = blend_module
    import stream_pipeline_offline as pipeline
    class CachedAudioFeatures:
        def __init__(self, **kwargs):
            self.support_streaming = True
            self.feat_dim = 1024
    pipeline.Wav2Feat = CachedAudioFeatures
    StreamSDK = pipeline.StreamSDK
    import queue
    pipeline.queue = types.SimpleNamespace(Queue=lambda maxsize: queue.Queue(maxsize=min(maxsize, 4)),
                                           Empty=queue.Empty, Full=queue.Full)
    from core.atomic_components.source2info import Source2Info
    tracked_landmarks = []
    original_source_call = Source2Info.__call__
    def source_call(self, *pos, **kwargs):
        result = original_source_call(self, *pos, **kwargs)
        result['f_s'] = result['f_s'].astype(np.float16)
        tracked_landmarks.append(result['lmk203'].copy())
        return result
    Source2Info.__call__ = source_call
    from core.atomic_components.condition_handler import ConditionHandler
    original_condition_setup = ConditionHandler.setup
    def condition_setup(self, setup_info, *pos, **kwargs):
        # Conditioning needs motion/eye data, not a duplicate of all appearance
        # volumes and source frames. Keep those solely in the renderer cache.
        small_info = {k: setup_info[k] for k in ['x_s_info_lst', 'sc', 'eye_open_lst', 'eye_ball_lst']}
        return original_condition_setup(self, small_info, *pos, **kwargs)
    ConditionHandler.setup = condition_setup

    calibration = None
    eye_checks = {'frames': 0, 'maxPreEncodeDifference': 0}
    if args.calibrated:
        calibration_path = OUT / 'casey-expression-calibration.json'
        calibration = json.loads(calibration_path.read_text())
        if not calibration['developmentCheckPassed'] or calibration['sourceSha256'] != digest(OUT / 'avatar-motion-reference-no-watermark.mp4'):
            raise RuntimeError('Calibration did not pass its development check or source changed')
        from core.atomic_components.motion_stitch import MotionStitch
        original_stitch_call = MotionStitch.__call__
        gain, offset, lower, upper = [np.array(calibration[k], dtype=np.float32).reshape(1, 63)
                                      for k in ['gain', 'offset', 'lower', 'upper']]
        rest_profile = None
        if args.relaxed_mouth:
            rest_path = OUT / 'casey-mouth-rest-profile.json'
            rest_profile = json.loads(rest_path.read_text())
            if rest_profile['sourceSha256'] != digest(OUT / 'avatar-motion-reference-no-watermark.mp4'):
                raise RuntimeError('Mouth rest profile source changed')
            rest = np.array(rest_profile['closedMouthExpression'], np.float32).reshape(1, 63)
            mouth_indices = np.array([i * 3 + axis for i in [6, 12, 14, 17, 19, 20] for axis in range(3)])
        def calibrated_stitch(self, source_info, driver_info, **kwargs):
            driver_info = dict(driver_info)
            driver_info['exp'] = np.clip(driver_info['exp'] * gain + offset, lower, upper)
            if rest_profile:
                exp = driver_info['exp'].copy()
                exp[:, mouth_indices] = rest[:, mouth_indices] + rest_profile['mouthGain'] * (exp[:, mouth_indices] - rest[:, mouth_indices])
                driver_info['exp'] = exp
            return original_stitch_call(self, source_info, driver_info, **kwargs)
        MotionStitch.__call__ = calibrated_stitch
        import cv2
        from core.atomic_components.putback import PutBack
        class PreserveRecordedEyes(PutBack):
            def __init__(self):
                super().__init__()
                self.frame_index = 0
            def __call__(self, original, generated, matrix):
                landmarks = tracked_landmarks[self.frame_index]
                self.frame_index += 1
                left = landmarks[[0, 6, 12, 18]].mean(0)
                right = landmarks[[24, 30, 36, 42]].mean(0)
                center = (left + right) / 2
                mouth = (landmarks[48] + landmarks[66]) / 2
                gap = max(20., float(mouth[1] - center[1]))
                slope = float((right[1] - left[1]) / (right[0] - left[0]))
                h, w = original.shape[:2]
                yy, xx = np.mgrid[:h, :w]
                below_eye = yy - center[1] - slope * (xx - center[0])
                ramp = np.clip((below_eye - .25 * gap) / (.25 * gap), 0, 1).astype(np.float32)
                ramp = ramp * ramp * (3 - 2 * ramp)
                mask = cv2.warpAffine(self.mask_ori_float, matrix[:2], (w, h)).clip(0, 1) * ramp
                warped = cv2.warpAffine(generated, matrix[:2], (w, h))
                alpha = mask[..., None]
                result = np.clip(warped * alpha + original * (1 - alpha), 0, 255).astype(np.uint8)
                protected = below_eye <= .25 * gap
                delta = int(np.abs(result[protected].astype(np.int16) - original[protected]).max())
                if delta:
                    raise RuntimeError('Recorded upper-face pixels changed before encoding')
                eye_checks['frames'] += 1
                eye_checks['maxPreEncodeDifference'] = max(eye_checks['maxPreEncodeDifference'], delta)
                return result
        pipeline.PutBack = PreserveRecordedEyes

    start = time.monotonic()
    source = OUT / 'avatar-motion-reference-no-watermark.mp4'
    cfg_path = RUNTIME / 'checkpoints/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl'
    with cfg_path.open('rb') as stream:
        cfg = pickle.load(stream)
    for key in ['insightface_det_cfg', 'landmark106_cfg', 'landmark203_cfg', 'landmark478_cfg', 'hubert_cfg']:
        cfg['base_cfg'][key]['device'] = 'cpu'
    local_cfg = OUT / f'{args.name}-runtime.pkl'
    with local_cfg.open('wb') as stream:
        pickle.dump(cfg, stream)
    print('Loading Ditto with CPU auxiliary models', flush=True)
    sdk = StreamSDK(str(local_cfg), str(RUNTIME / 'checkpoints/ditto_pytorch'))
    silent = OUT / f'{args.name}-render.mp4'
    count = args.seconds * 25
    print(f'Registering {count} original video frames', flush=True)
    sdk.setup(str(source), str(silent), template_n_frames=count, N_d=count,
              max_size=1024, ch_info=None, relative_d=False, use_d_keys=['exp'],
              drive_eye=False, delta_eye_arr=None, smo_k_s=3, smo_k_d=3,
              emo=4, overall_ctrl_info={})
    # Drive all expression coordinates together, preserving source pose and
    # body frames. Do not restrict animation to the default mouth keypoints.
    sdk.motion_stitch.fix_exp_a1 = np.ones((1, 63), dtype=np.float32)
    sdk.motion_stitch.fix_exp_a2 = np.zeros((1, 63), dtype=np.float32)
    sdk.motion_stitch.fix_exp_a3 = np.zeros((1, 63), dtype=np.float32)
    if args.calibrated:
        for eye in [11, 13, 15, 16, 18]:
            sdk.motion_stitch.fix_exp_a1[:, eye * 3:eye * 3 + 3] = 0
            sdk.motion_stitch.fix_exp_a2[:, eye * 3:eye * 3 + 3] = 1
    sdk.setup_Nd(count)
    print('Rendering full expressions from cached audio features', flush=True)
    sdk.audio2motion_queue.put(features)
    sdk.close()
    final = OUT / f'{args.name}.mp4'
    subprocess.run([str(BIN / 'ffmpeg.exe'), '-v', 'error', '-y', '-i', sdk.tmp_output_path,
                    '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-t', str(args.seconds),
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
                    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-movflags', '+faststart', str(final)], check=True)
    subprocess.run([str(BIN / 'ffmpeg.exe'), '-v', 'error', '-i', str(final), '-f', 'null', 'NUL'], check=True)
    probe = json.loads(subprocess.check_output([str(BIN / 'ffprobe.exe'), '-v', 'error',
                       '-show_streams', '-of', 'json', str(final)]))
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    a = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    assert int(v['nb_frames']) == count
    assert abs(float(v['duration']) - float(a['duration'])) < .04
    receipt = {'model': 'Ditto PyTorch', 'voiceSha256': digest(voice), 'sourceSha256': digest(source),
               'outputSha256': digest(final), 'frames': count, 'fps': 25,
               'width': int(v['width']), 'height': int(v['height']),
               'videoDurationSeconds': float(v['duration']), 'audioDurationSeconds': float(a['duration']),
               'elapsedSeconds': time.monotonic() - start, 'gpuPeakAllocatedBytes': torch.cuda.max_memory_allocated(),
               'expression': ('calibrated non-eye expression; recorded upper face retained' if args.calibrated else
                              'all 21 keypoints; source pose preserved; absolute generated expression'),
               'calibrationSha256': digest(calibration_path) if args.calibrated else None,
               'eyePreservation': eye_checks if args.calibrated else None,
               'mouthRestProfileSha256': digest(rest_path) if args.relaxed_mouth else None,
               'mouthGain': rest_profile['mouthGain'] if args.relaxed_mouth else 1,
               'sourceFrames': 'one-to-one; no looping', 'fullDecodePassed': True,
               'qualityApproved': False, 'commercialDependencyClearance': False}
    final.with_suffix('.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt), flush=True)

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    main()
