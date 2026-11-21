"""Measure bounded visual proxies and write matched review frames, not acceptance."""
import json
from pathlib import Path
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/avatar-research/2026-10-19'

def main():
    cv2.setNumThreads(2)
    detector = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(ROOT.parent / 'CineGen/public/retouch/face_landmarker.task')),
        num_faces=1))
    rows, metrics = {}, {}
    for name in ['casey-avatar-calibrated', 'casey-avatar-camera']:
        cap = cv2.VideoCapture(str(OUT / f'{name}.mp4'))
        openings, bright = [], []
        index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            if len(result.face_landmarks) != 1:
                raise RuntimeError('Face tracking missing during review')
            xy = np.array([[p.x * frame.shape[1], p.y * frame.shape[0]] for p in result.face_landmarks[0]])
            openings.append(float(np.linalg.norm(xy[13] - xy[14]) / np.linalg.norm(xy[61] - xy[291])))
            mask = np.zeros(frame.shape[:2], np.uint8)
            inner = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
            cv2.fillPoly(mask, [xy[inner].astype(np.int32)], 1)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            bright.append(int(((mask > 0) & (hsv[:, :, 1] < 80) & (hsv[:, :, 2] > 135)).sum()))
            if index in [15, 45, 80, 125]:
                crop = cv2.resize(frame[90:540, 330:690], (288, 360))
                panel = np.full((392, 288, 3), 20, np.uint8)
                panel[32:] = crop
                label = 'Previous' if name.endswith('calibrated') else 'Mouth + gaze'
                cv2.putText(panel, f'{label} {index / 25:.2f}s', (10, 22), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 1, cv2.LINE_AA)
                rows.setdefault(index, []).append(panel)
            index += 1
        cap.release()
        if index != 150:
            raise RuntimeError('Incomplete review video')
        metrics[name] = {'frames': index, 'meanLipOpeningRatio': float(np.mean(openings)),
                         'p90LipOpeningRatio': float(np.quantile(openings, .9)),
                         'meanBrightInnerMouthPixels': float(np.mean(bright)),
                         'note': 'Bright mouth pixels are a rough teeth-exposure proxy; not a segmentation or quality score.'}
    detector.close()
    cv2.imwrite(str(OUT / 'casey-camera-contact.jpg'), np.vstack([np.hstack(row) for row in rows.values()]))
    (OUT / 'casey-camera-review.json').write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics), flush=True)

if __name__ == '__main__':
    main()
