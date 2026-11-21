"""Bounded local MuseTalk test: preserve frame pairing and stream the final edit."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'data/avatar-runtime/MuseTalk'
OUT = ROOT / 'output/avatar-research/2026-10-19'
SOURCE = OUT / 'avatar-motion-reference-no-watermark.mp4'
FRAMES = OUT / 'motion-frames'
COORDS = OUT / 'motion-coordinates.json'
FFMPEG = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def prepare():
    import cv2
    from musetalk.utils.preprocessing import get_landmark_and_bbox
    FRAMES.mkdir(exist_ok=True)
    subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(SOURCE), '-start_number', '0',
                    '-y', str(FRAMES / '%06d.png')], check=True)
    paths = sorted(FRAMES.glob('*.png'))
    if len(paths) != 500:
        raise RuntimeError(f'Expected 500 source frames; found {len(paths)}.')
    coords = []
    # Small batches bound CPU memory; each source frame gets its own landmarks.
    for offset in range(0, len(paths), 25):
        boxes, frames = get_landmark_and_bbox([str(p) for p in paths[offset:offset + 25]], 0)
        for bbox, frame in zip(boxes, frames):
            x1, y1, x2, y2 = map(int, bbox)
            y2 = min(y2 + 10, frame.shape[0])
            if not (0 <= x1 < x2 <= frame.shape[1] and 0 <= y1 < y2 <= frame.shape[0]):
                raise RuntimeError(f'Invalid face box at frame {len(coords)}: {bbox}')
            coords.append([x1, y1, x2, y2])
        print(f'Prepared {len(coords)}/{len(paths)} frames', flush=True)
    if len(coords) != len(paths):
        raise RuntimeError('Landmark/source frame count mismatch.')
    COORDS.write_text(json.dumps({'sourceSha256': sha(SOURCE), 'fps': 25, 'boxes': coords}), encoding='utf-8')
    for i in [0, 125, 250, 375, 499]:
        frame = cv2.imread(str(paths[i]))
        x1, y1, x2, y2 = coords[i]
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.imwrite(str(OUT / f'face-box-{i:03d}.jpg'), frame)


def render(audio_path, name, source_offset, blend_mode, stabilize=False, latent_mode='sample', seconds=None, normalize_audio=True):
    import cv2
    import numpy as np
    import torch
    import soundfile as sf
    from PIL import Image
    from transformers import WhisperModel
    from musetalk.models.vae import VAE
    from musetalk.models.unet import PositionalEncoding
    from diffusers import UNet2DConditionModel
    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.utils.face_parsing import FaceParsing
    from musetalk.utils.blending import get_image

    torch.manual_seed(42)
    start = time.monotonic()
    coords = json.loads(COORDS.read_text())
    if coords['sourceSha256'] != sha(SOURCE):
        raise RuntimeError('Source changed after face preparation.')
    paths = sorted(FRAMES.glob('*.png'))
    if len(paths) != len(coords['boxes']):
        raise RuntimeError('Source frame and landmark counts do not match.')
    paths = paths[source_offset:]
    coords['boxes'] = coords['boxes'][source_offset:]
    fps = coords.get('fps', 25)
    first_frame = cv2.imread(str(paths[0]))
    height, width = first_frame.shape[:2]
    del first_frame
    if stabilize:
        # Symmetric offline smoothing avoids a tracking delay. Smooth geometry,
        # never generated mouth images, so consonants are not blurred in time.
        boxes = np.asarray(coords['boxes'], dtype=np.float32)
        padded = np.pad(boxes, ((2, 2), (0, 0)), mode='edge')
        boxes = np.stack([np.median(padded[i:i + 5], axis=0) for i in range(len(boxes))])
        padded = np.pad(boxes, ((2, 2), (0, 0)), mode='edge')
        weights = np.array([1, 2, 3, 2, 1], dtype=np.float32) / 9
        coords['boxes'] = np.rint(np.stack([(padded[i:i + 5] * weights[:, None]).sum(0)
                                           for i in range(len(boxes))])).astype(int).tolist()
    audio = sf.info(audio_path)
    if not 0 < audio.duration <= 20:
        raise RuntimeError('This test needs 0-20 seconds of speech; never loop/reverse the motion.')
    processor = AudioProcessor(str(RUNTIME / 'models/whisper'))
    whisper = WhisperModel.from_pretrained(RUNTIME / 'models/whisper', local_files_only=True).to('cuda', dtype=torch.float16).eval()
    features, length = processor.get_audio_feature(str(audio_path))
    with torch.inference_mode():
        chunks = processor.get_whisper_chunk(features, 'cuda', torch.float16, whisper, length, fps=fps)
    if seconds is not None:
        chunks = chunks[:int(seconds * fps)]
    del whisper
    torch.cuda.empty_cache()
    if len(chunks) > len(paths) or len(paths) != len(coords['boxes']):
        raise RuntimeError('Insufficient or mismatched source frames.')
    vae = VAE(model_path=str(RUNTIME / 'models/sd-vae'), use_float16=True)
    # Construct FP16 on CPU, then copy the official checkpoint before moving to
    # CUDA. Avoid the upstream loader's temporary full-precision GPU model.
    original_dtype = torch.get_default_dtype()
    try:
        torch.set_default_dtype(torch.float16)
        unet = UNet2DConditionModel(**json.loads((RUNTIME / 'models/musetalkV15/musetalk.json').read_text()))
    finally:
        torch.set_default_dtype(original_dtype)
    weights = torch.load(RUNTIME / 'models/musetalkV15/unet.pth', map_location='cpu')
    unet.load_state_dict(weights)
    del weights
    unet = unet.to('cuda').eval()
    pe = PositionalEncoding(d_model=384).to('cuda', dtype=torch.float16)
    parser = FaceParsing(left_cheek_width=90, right_cheek_width=90)

    def lowerface_blend(frame, face, box):
        x1, y1, x2, y2 = box
        h, w = y2 - y1, x2 - x1
        # A stable region moves lips and surrounding cheeks/jaw together.
        # Feather only its perimeter; leave the mouth fully generated.
        mask = np.zeros((h, w), dtype=np.uint8)
        polygon = np.array([[.22, .52], [.78, .52], [.96, .65], [.90, .88],
                            [.72, .99], [.28, .99], [.10, .88], [.04, .65]])
        cv2.fillConvexPoly(mask, np.rint(polygon * [w - 1, h - 1]).astype(np.int32), 255)
        feather = max(5, int(w * .09) | 1)
        alpha = cv2.GaussianBlur(mask, (feather, feather), 0).astype(np.float32)[..., None] / 255
        combined = frame.copy()
        combined[y1:y2, x1:x2] = np.round(face * alpha + frame[y1:y2, x1:x2] * (1 - alpha)).astype(np.uint8)
        return combined

    def mouth_blend(frame, face, box):
        x1, y1, x2, y2 = box
        original = frame[y1:y2, x1:x2]
        masks = []
        # Union both mouth shapes so a newly open mouth is never clipped by
        # the original closed-mouth shape. Keep surrounding identity texture.
        for crop in [original, face]:
            rgb = Image.fromarray(crop[:, :, ::-1]).resize((512, 512), Image.Resampling.BILINEAR)
            tensor = parser.preprocess(rgb).unsqueeze(0).to('cuda')
            classes = parser.net(tensor)[0].argmax(dim=1).squeeze().cpu().numpy()
            mask = np.isin(classes, [11, 12, 13]).astype(np.uint8) * 255
            masks.append(cv2.resize(mask, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST))
        mask = np.maximum(masks[0], masks[1])
        if not np.any(mask):
            raise RuntimeError('Mouth mask was empty; refusing an untracked face replacement.')
        dilation = max(5, int((x2 - x1) * 0.10) | 1)
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation, dilation)))
        feather = max(3, int((x2 - x1) * 0.05) | 1)
        alpha = cv2.GaussianBlur(mask, (feather, feather), 0).astype(np.float32)[..., None] / 255
        combined = frame.copy()
        combined[y1:y2, x1:x2] = np.round(face * alpha + original * (1 - alpha)).astype(np.uint8)
        return combined
    timesteps = torch.tensor([0], device='cuda')
    silent = OUT / f'{name}-silent.mp4'
    final = OUT / f'{name}.mp4'
    command = [str(FFMPEG), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
               '-s', f'{width}x{height}', '-r', str(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
               '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', str(silent)]
    with (OUT / f'{name}-ffmpeg.log').open('wb') as log:
        encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log)
        try:
            with torch.inference_mode():
                for i, chunk in enumerate(chunks):
                    frame = cv2.imread(str(paths[i]))
                    x1, y1, x2, y2 = coords['boxes'][i]
                    crop = cv2.resize(frame[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
                    if latent_mode == 'mean':
                        encoded = [vae.vae.encode(vae.preprocess_img(crop, half_mask=half).to(dtype=torch.float16)).latent_dist.mean
                                   * vae.scaling_factor for half in [True, False]]
                        latents = torch.cat(encoded, dim=1)
                    else:
                        latents = vae.get_latents_for_unet(crop).to(dtype=torch.float16)
                    audio_features = pe(chunk.unsqueeze(0).to('cuda', dtype=torch.float16))
                    prediction = unet(latents, timesteps, encoder_hidden_states=audio_features).sample
                    face = vae.decode_latents(prediction)[0]
                    face = cv2.resize(face, (x2 - x1, y2 - y1))
                    if blend_mode == 'mouth':
                        combined = mouth_blend(frame, face, [x1, y1, x2, y2])
                    elif blend_mode == 'lowerface':
                        combined = lowerface_blend(frame, face, [x1, y1, x2, y2])
                    else:
                        combined = get_image(frame, face, [x1, y1, x2, y2], mode='jaw', fp=parser)
                    encoder.stdin.write(np.ascontiguousarray(combined).tobytes())
                    if i % 25 == 0:
                        cv2.imwrite(str(OUT / f'{name}-frame-{i:03d}.jpg'), combined)
                        print(f'Rendered {i + 1}/{len(chunks)} frames', flush=True)
            encoder.stdin.close()
            if encoder.wait(timeout=60):
                raise RuntimeError('Video encoder failed; retained its log.')
        except BaseException:
            encoder.kill()
            encoder.wait()
            raise
    subprocess.run([str(FFMPEG), '-v', 'error', '-y', '-i', str(silent), '-i', str(audio_path),
                    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                    *(['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000'] if normalize_audio else []),
                    '-shortest', '-movflags', '+faststart', str(final)], check=True)
    subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(final), '-f', 'null', 'NUL'], check=True)
    receipt = {'model': 'MuseTalk 1.5', 'sourceSha256': sha(SOURCE), 'audioSha256': sha(audio_path),
               'output': str(final), 'outputSha256': sha(final), 'fps': fps, 'frames': len(chunks),
               'audioDurationSeconds': audio.duration, 'elapsedSeconds': time.monotonic() - start,
               'outputAudioFilter': 'loudnorm=I=-16:TP=-1.5:LRA=11' if normalize_audio else None,
               'gpuPeakAllocatedBytes': torch.cuda.max_memory_allocated(), 'fullDecodePassed': True,
               'sourceFramePairing': 'one-to-one, no looping or reversed frames', 'sourceOffsetFrames': source_offset,
               'blendMode': blend_mode,
               'stabilizedBoxes': stabilize, 'latentMode': latent_mode,
               'requestedPreviewSeconds': seconds,
               'qualityApproved': False, 'playbackReviewRequired': True}
    final.with_suffix('.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    # Upstream progress messages include Unicode; Windows redirected streams
    # otherwise default to a legacy code page and can stop an otherwise good run.
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    p = argparse.ArgumentParser()
    p.add_argument('stage', choices=['prepare', 'render'])
    p.add_argument('--audio', type=Path)
    p.add_argument('--name', default='casey-avatar-v1')
    p.add_argument('--source-offset', type=int, default=0)
    p.add_argument('--blend', choices=['mouth', 'jaw', 'lowerface'], default='mouth')
    p.add_argument('--stabilize', action='store_true')
    p.add_argument('--latent', choices=['sample', 'mean'], default='sample')
    p.add_argument('--seconds', type=float)
    args = p.parse_args()
    if not args.name.replace('-', '').replace('_', '').isalnum():
        raise ValueError('Use a simple output name.')
    if not 0 <= args.source_offset < 500:
        raise ValueError('Source offset must identify an existing frame.')
    if args.seconds is not None and not 0.04 <= args.seconds <= 20:
        raise ValueError('Preview duration must be between 0.04 and 20 seconds.')
    audio_path = args.audio.resolve() if args.audio else None
    os.chdir(RUNTIME)
    sys.path.insert(0, str(RUNTIME))
    import torch
    torch.set_num_threads(2)
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA presenter runtime is required for this test.')
    if args.stage == 'prepare':
        prepare()
    else:
        if audio_path is None or not audio_path.is_file():
            raise ValueError('Supply a local audio file.')
        render(audio_path, args.name, args.source_offset, args.blend, args.stabilize, args.latent, args.seconds)
