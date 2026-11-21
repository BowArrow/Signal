"""Measure personal mouth rest and eye references locally; no model training."""
import json
import hashlib
from pathlib import Path
import cv2
import numpy as np
import mediapipe as mp
import onnxruntime as ort
from mediapipe.tasks.python import vision, BaseOptions

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/avatar-research/2026-10-19'
WORK = OUT / 'face-refinement'
CINE = ROOT.parent / 'CineGen'
SOURCE = OUT / 'avatar-motion-reference-no-watermark.mp4'
ORIGINAL = Path(r'C:\Users\cshor\Videos\Camo Studio Recording 2026-09-21 14-09-41.mp4')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    WORK.mkdir(exist_ok=True)
    cv2.setNumThreads(2)
    detector = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(CINE / 'public/retouch/face_landmarker.task')),
        num_faces=1, output_face_blendshapes=True, output_facial_transformation_matrixes=True))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    gaze_model = ort.InferenceSession(str(CINE / 'public/retouch/gaze-estimator-mobileone-s0-v1.onnx'),
                                    sess_options=options, providers=['CPUExecutionProvider'])
    def detect(frame, with_gaze):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if len(result.face_landmarks) != 1:
            raise RuntimeError('Expected exactly one tracked owner face')
        lm = result.face_landmarks[0]
        detection = {'faceLandmarks': [[{'x': p.x, 'y': p.y, 'z': p.z} for p in lm]],
                     'faceBlendshapes': [{'categories': [{'categoryName': s.category_name, 'score': s.score}
                                                      for s in result.face_blendshapes[0]]}],
                     'facialTransformationMatrixes': [{'data': result.facial_transformation_matrixes[0].T.flatten().tolist()}]}
        xy = np.array([[p.x * frame.shape[1], p.y * frame.shape[0]] for p in lm])
        mouth = float(np.linalg.norm(xy[13] - xy[14]) / np.linalg.norm(xy[61] - xy[291]))
        gaze = None
        if with_gaze:
            low = np.maximum(xy.min(0).astype(int), 0)
            high = np.minimum(np.ceil(xy.max(0)).astype(int), [frame.shape[1], frame.shape[0]])
            crop = cv2.resize(rgb[low[1]:high[1], low[0]:high[0]], (448, 448))
            data = ((crop.astype(np.float32) / 255 - np.array([.485, .456, .406], np.float32)) /
                    np.array([.229, .224, .225], np.float32)).transpose(2, 0, 1)[None]
            logits = gaze_model.run(None, {gaze_model.get_inputs()[0].name: data})
            def decode(a):
                a = a.flatten()
                p = np.exp(a - a.max())
                return float((np.sum(p * np.arange(len(a))) / p.sum() * 4 - 180) * np.pi / 180)
            gaze = {'yaw': decode(logits[0]), 'pitch': decode(logits[1])}
        return detection, gaze, mouth
    frames, references, openings = [], [], []
    cap = cv2.VideoCapture(str(SOURCE))
    for i in range(500):
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError('Incomplete calibration video')
        detection, gaze, mouth = detect(frame, i < 150)
        openings.append(mouth)
        if i < 150:
            filename = f'source-{i:04}.rgba'
            cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA).tofile(WORK / filename)
            frames.append({'file': filename, 'time': i / 25, 'detection': detection, 'gaze': gaze})
        if i % 100 == 0:
            print(f'Measured mouth/eyes {i}/500', flush=True)
    cap.release()
    pairs = np.load(OUT / 'casey-expression-calibration-pairs.npz')
    # Use the owner's most closed real lip configurations as a rest anchor.
    closed = np.argsort(openings)[:40]
    profile = {'sourceSha256': sha(SOURCE), 'closedFrameIndices': closed.tolist(),
               'closedMouthExpression': np.median(pairs['observed'][closed], axis=0).tolist(),
               'mouthOpeningQuantiles': np.quantile(openings, [0, .1, .5, .9, 1]).tolist(),
               'mouthGain': .68, 'neuralWeightsUpdated': False}
    (OUT / 'casey-mouth-rest-profile.json').write_text(json.dumps(profile, indent=2))
    cap = cv2.VideoCapture(str(ORIGINAL))
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS)
    for i, seconds in enumerate(np.arange(0, duration - 1, 2)):
        cap.set(cv2.CAP_PROP_POS_MSEC, float(seconds * 1000))
        ok, frame = cap.read()
        if not ok:
            continue
        frame = frame[:576, 128:1152].copy()
        detection, gaze, _ = detect(frame, True)
        filename = f'reference-{i:04}.rgba'
        cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA).tofile(WORK / filename)
        references.append({'file': filename, 'time': float(seconds), 'detection': detection, 'gaze': gaze})
        if i % 25 == 0:
            print(f'Scanned original camera-gaze reference {seconds:.0f}s/{duration:.0f}s', flush=True)
    cap.release()
    detector.close()
    (WORK / 'tracking.json').write_text(json.dumps({'width': 1024, 'height': 576,
        'sourceSha256': sha(SOURCE), 'frames': frames, 'references': references}))
    print(json.dumps({'frames': len(frames), 'references': len(references), 'mouthProfile': profile}), flush=True)

if __name__ == '__main__':
    main()
