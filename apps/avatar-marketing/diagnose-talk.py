"""CPU-only face/activity diagnostics. Proxies never approve perceptual lip sync."""
import argparse
import json
from pathlib import Path
import cv2
import mediapipe as mp
import numpy as np
from scipy.io import wavfile
from mediapipe.tasks.python import vision, BaseOptions

parser = argparse.ArgumentParser()
parser.add_argument('render', type=Path)
args = parser.parse_args()
cv2.setNumThreads(2)
model = Path(__file__).resolve().parents[2].parent / 'CineGen/public/retouch/face_landmarker.task'
detector = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=str(model), delegate=BaseOptions.Delegate.CPU),
    num_faces=1, output_face_blendshapes=True))
cap = cv2.VideoCapture(str(args.render / 'video.mp4'))
fps = cap.get(cv2.CAP_PROP_FPS)
rate, audio = wavfile.read(args.render / 'input-audio.wav')
audio = audio.astype(float) / 32768
rows = []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    i = len(rows)
    result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                     data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
    if len(result.face_landmarks) != 1:
        raise RuntimeError(f'Face tracking failed at frame {i}.')
    xy = np.array([[p.x * frame.shape[1], p.y * frame.shape[0]] for p in result.face_landmarks[0]])
    aperture = float(np.linalg.norm(xy[13]-xy[14]) / np.linalg.norm(xy[61]-xy[291]))
    shapes = {s.category_name:float(s.score) for s in result.face_blendshapes[0]}
    samples = audio[round(i*rate/fps):round((i+1)*rate/fps)]
    rows.append({'time':i/fps,'mouthOpeningRatio':aperture,
                 'rms':float(np.sqrt(np.mean(samples**2))) if len(samples) else 0,
                 'jawOpen':shapes.get('jawOpen'),
                 'smileLeft':shapes.get('mouthSmileLeft'), 'smileRight':shapes.get('mouthSmileRight')})
cap.release()
detector.close()
mouth = np.array([r['mouthOpeningRatio'] for r in rows])
energy = np.array([r['rms'] for r in rows])
correlations = []
for lag in range(-12,13):
    a,b = (mouth[lag:],energy[:len(energy)-lag]) if lag>=0 else (mouth[:len(mouth)+lag],energy[-lag:])
    correlations.append({'mouthLagFrames':lag,'correlation':float(np.corrcoef(a,b)[0,1])})
summary = {'frames':len(rows),'fps':fps,'maximumActivityCorrelation':max(correlations,key=lambda r:r['correlation']),
           'zeroLagActivityCorrelation':correlations[12]['correlation'],
           'meanMouthOpeningRatio':float(mouth.mean()),
           'note':'Mouth aperture versus audio RMS is a coarse activity proxy, not phoneme synchronization or naturalness. Never automatically shift audio from this result.',
           'qualityApproved':False}
(args.render/'talk-diagnostics.json').write_text(json.dumps({'summary':summary,'correlations':correlations,'frames':rows},indent=2))
print(json.dumps(summary))
