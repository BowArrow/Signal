"""Fit bounded expression calibration to matched owner video/audio, not model weights."""
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

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/avatar-research/2026-10-19'
RUNTIME = ROOT / 'data/avatar-runtime/Ditto'
ORIGINAL = Path(r'C:\Users\cshor\Videos\Camo Studio Recording 2026-09-21 14-09-41.mp4')
SOURCE = OUT / 'avatar-motion-reference-no-watermark.mp4'
BIN = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin'

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('stage', choices=['audio', 'fit'])
    args = p.parse_args()
    sys.path.insert(0, str(RUNTIME))
    os.chdir(RUNTIME)
    import numpy as np
    import onnxruntime as ort
    np.random.seed(42)
    random.seed(42)
    original_session = ort.InferenceSession
    def session(*pos, **kwargs):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        kwargs.setdefault('sess_options', options)
        kwargs['providers'] = ['CPUExecutionProvider']
        return original_session(*pos, **kwargs)
    ort.InferenceSession = session
    audio = OUT / 'calibration-original-80-100.wav'
    feature_path = OUT / 'calibration-original-features.npy'
    if args.stage == 'audio':
        import librosa
        from core.atomic_components.wav2feat import Wav2Feat
        subprocess.run([str(BIN / 'ffmpeg.exe'), '-v', 'error', '-y', '-ss', '80', '-i', str(ORIGINAL),
                        '-t', '20', '-vn', '-ar', '16000', '-ac', '1', str(audio)], check=True)
        extractor = Wav2Feat({'model_path': str(RUNTIME / 'checkpoints/ditto_pytorch/aux_models/hubert_streaming_fix_kv.onnx'),
                             'device': 'cpu', 'force_ori_type': True})
        samples, _ = librosa.load(str(audio), sr=16000)
        features = extractor.wav2feat(samples)
        if features.shape != (500, 1024) or not np.isfinite(features).all():
            raise RuntimeError('Invalid calibration audio features')
        np.save(feature_path, features, allow_pickle=False)
        feature_path.with_suffix('.json').write_text(json.dumps({'sourceSha256': sha(SOURCE),
            'audioSha256': sha(audio), 'featureSha256': sha(feature_path), 'originalOffsetSeconds': 80,
            'seconds': 20, 'fps': 25}, indent=2))
        print('Saved 500 matched audio feature frames', flush=True)
        return
    receipt = json.loads(feature_path.with_suffix('.json').read_text())
    if receipt['sourceSha256'] != sha(SOURCE) or receipt['featureSha256'] != sha(feature_path) or receipt['audioSha256'] != sha(audio):
        raise RuntimeError('Calibration assets changed')
    import torch
    import cv2
    from core.atomic_components.cfg import parse_cfg
    from core.atomic_components.source2info import Source2Info
    from core.atomic_components.condition_handler import ConditionHandler
    from core.atomic_components.audio2motion import Audio2Motion
    torch.set_num_threads(2)
    torch.manual_seed(42)
    start = time.monotonic()
    cfg_path = RUNTIME / 'checkpoints/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl'
    with cfg_path.open('rb') as f:
        cfg = pickle.load(f)
    for name in ['insightface_det_cfg', 'landmark106_cfg', 'landmark203_cfg', 'landmark478_cfg']:
        cfg['base_cfg'][name]['device'] = 'cpu'
    local_cfg = OUT / 'calibration-runtime.pkl'
    with local_cfg.open('wb') as f:
        pickle.dump(cfg, f)
    registrar_cfg, condition_cfg, motion_cfg, *_ = parse_cfg(str(local_cfg), str(RUNTIME / 'checkpoints/ditto_pytorch'))
    source2info = Source2Info(**registrar_cfg)
    # Calibration extracts expression only; do not allocate appearance volumes.
    source2info._get_f3d = lambda image: None
    source_info = {'x_s_info_lst': [], 'eye_open_lst': [], 'eye_ball_lst': []}
    cap = cv2.VideoCapture(str(SOURCE))
    previous = None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        info = source2info(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), previous)
        previous = info['lmk203']
        for key in ['x_s_info', 'eye_open', 'eye_ball']:
            source_info[key + '_lst'].append(info[key])
        if len(source_info['x_s_info_lst']) % 100 == 0:
            print(f'Measured owner expressions: {len(source_info["x_s_info_lst"])}/500', flush=True)
    cap.release()
    if len(source_info['x_s_info_lst']) != 500:
        raise RuntimeError('Calibration requires 500 matched source frames')
    source_info['sc'] = source_info['x_s_info_lst'][0]['kp'].flatten()
    condition = ConditionHandler(**condition_cfg)
    condition.setup(source_info, emo=4, ch_info=None)
    motion = Audio2Motion(motion_cfg)
    defaults = cfg['default_kwargs']
    motion.setup(condition.x_s_info_0, overlap_v2=10, fix_kp_cond=1, fix_kp_cond_dim=[0, 202],
                 sampling_timesteps=50, online_mode=False, v_min_max_for_clip=defaults['v_min_max_for_clip'], smo_k_d=3)
    features = np.load(feature_path, allow_pickle=False)
    cond = condition(features, 0)
    predicted = None
    for offset in range(0, len(cond), motion.valid_clip_len):
        part = cond[offset:offset + motion.seq_frames][None]
        if part.shape[1] < motion.seq_frames:
            part = np.concatenate([part, np.repeat(part[:, -1:], motion.seq_frames - part.shape[1], axis=1)], axis=1)
        predicted = motion(part, predicted)
        print(f'Predicted reference speech window at {offset}/500', flush=True)
    predicted = motion._smo(predicted[:, :500], 0, 500)
    x = np.concatenate([v['exp'] for v in motion.cvt_fmt(predicted)], axis=0)
    y = np.concatenate([v['exp'] for v in source_info['x_s_info_lst']], axis=0)
    # Fit on 15 seconds; reserve the final 5 seconds for development comparison.
    train = 375
    mx, my = x[:train].mean(0), y[:train].mean(0)
    dx, dy = x[:train] - mx, y[:train] - my
    variance = np.mean(dx * dx, 0)
    ridge = np.maximum(variance * .5, 1e-8)
    gain = np.clip((np.mean(dx * dy, 0) + ridge) / (variance + ridge), .5, 1.25)
    offset = my - gain * mx
    lo, hi = np.quantile(y[:train], [.01, .99], axis=0)
    margin = np.maximum((hi - lo) * .25, .0002)
    lo, hi = lo - margin, hi + margin
    def transform(values):
        return np.clip(values * gain + offset, lo, hi)
    active = np.ones(63, dtype=bool)
    for eye in [11, 13, 15, 16, 18]:
        active[eye * 3:eye * 3 + 3] = False
    def rmse(a, b):
        return float(np.sqrt(np.mean((a[:, active] - b[:, active]) ** 2)))
    raw_rmse = rmse(x[train:], y[train:])
    calibrated_rmse = rmse(transform(x[train:]), y[train:])
    # Preserve evidence even when the calibration fails its development check.
    np.savez_compressed(OUT / 'casey-expression-calibration-pairs.npz', predicted=x, observed=y)
    result = {'method': 'bounded per-coordinate affine calibration; no neural weight training',
              'sourceSha256': sha(SOURCE), 'originalAudioSha256': sha(audio),
              'trainFrames': train, 'developmentFrames': 125, 'fps': 25,
              'gain': gain.tolist(), 'offset': offset.tolist(), 'lower': lo.tolist(), 'upper': hi.tolist(),
              'rawDevelopmentExpressionRmse': raw_rmse, 'calibratedDevelopmentExpressionRmse': calibrated_rmse,
              'developmentCheckPassed': calibrated_rmse < raw_rmse,
              'qualityApproved': False, 'elapsedSeconds': time.monotonic() - start,
              'note': 'Latent expression error is not a perceptual likeness or lip-sync score.'}
    (OUT / 'casey-expression-calibration.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k not in ['gain', 'offset', 'lower', 'upper']}), flush=True)

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    main()
