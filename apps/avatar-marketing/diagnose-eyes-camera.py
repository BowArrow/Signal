"""CPU review aids: eye crops and background scale, never automatic quality approval."""
import argparse
import json
from pathlib import Path
import cv2
import mediapipe as mp
import numpy as np
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
frames, rows, crops = [], [], []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    i = len(frames)
    frames.append(frame)
    result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                     data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
    row = {'frame':i, 'time':i/fps, 'tracked':len(result.face_landmarks)==1}
    if row['tracked']:
        h,w = frame.shape[:2]
        xy = np.array([[p.x*w,p.y*h] for p in result.face_landmarks[0]])
        eye = xy[[33,133,159,145,362,263,386,374]]
        lo,hi = eye.min(axis=0),eye.max(axis=0)
        pad = (hi[0]-lo[0])*.12
        x1,y1 = np.maximum(0,np.floor(lo-pad)).astype(int)
        x2,y2 = np.minimum([w,h],np.ceil(hi+pad)).astype(int)
        crop = frame[y1:y2,x1:x2]
        crop = cv2.resize(crop,(320,112),interpolation=cv2.INTER_CUBIC)
        shapes={s.category_name:float(s.score) for s in result.face_blendshapes[0]}
        row.update(eyeSharpness=float(cv2.Laplacian(cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var()),
                   blinkLeft=shapes.get('eyeBlinkLeft',0),blinkRight=shapes.get('eyeBlinkRight',0),
                   faceWidth=float(np.linalg.norm(xy[234]-xy[454])),eyeBox=[int(x1),int(y1),int(x2),int(y2)])
        crops.append(crop)
    else:
        crops.append(np.zeros((112,320,3),np.uint8))
    rows.append(row)
cap.release()
detector.close()
if not frames:
    raise RuntimeError('No decoded frames')
gray0=cv2.cvtColor(frames[0],cv2.COLOR_BGR2GRAY)
mask=np.full(gray0.shape,255,np.uint8)
# Exclude the central presenter and lower foreground from background tracking.
h,w=mask.shape
mask[int(h*.16):,int(w*.18):int(w*.84)]=0
mask[int(h*.72):,:]=0
features=cv2.goodFeaturesToTrack(gray0,maxCorners=250,qualityLevel=.02,minDistance=9,mask=mask)
for frame,row in zip(frames,rows):
    if features is None:
        continue
    points,status,_=cv2.calcOpticalFlowPyrLK(gray0,cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),features,None,
                                           winSize=(31,31),maxLevel=4)
    if points is None or status is None:
        continue
    good=status[:,0]==1
    if int(good.sum())<12:
        continue
    matrix,inliers=cv2.estimateAffinePartial2D(features[good],points[good],method=cv2.RANSAC,ransacReprojThreshold=2.5)
    if matrix is not None:
        row.update(backgroundScale=float(np.hypot(matrix[0,0],matrix[1,0])),
                   backgroundTranslation=[float(matrix[0,2]),float(matrix[1,2])],
                   backgroundInliers=int(inliers.sum()))
indices=np.linspace(0,len(frames)-1,16,dtype=int)
def grid(indices,name):
    tiles=[]
    for i in indices:
        tile=np.zeros((140,320,3),np.uint8);tile[:112]=crops[i]
        cv2.putText(tile,f'{i:03d}  {i/fps:.3f}s',(8,132),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
        tiles.append(tile)
    while len(tiles)%4:
        tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(str(args.render/name),np.concatenate([np.concatenate(tiles[j:j+4],axis=1) for j in range(0,len(tiles),4)],axis=0))
grid(indices,'eyes-over-time.jpg')
open_rows=[r for r in rows if r.get('tracked') and max(r['blinkLeft'],r['blinkRight'])<.25]
if open_rows:
    lowest=min(open_rows,key=lambda r:r['eyeSharpness'])
    start=max(0,min(len(frames)-16,lowest['frame']-8))
    grid(range(start,min(start+16,len(frames))),'eyes-consecutive.jpg')
scales=[r['backgroundScale'] for r in rows if r.get('backgroundInliers',0)>=12]
summary={'frames':len(frames),'fps':fps,'backgroundScaleRange':[min(scales),max(scales)] if scales else None,
         'faceTrackingFailures':sum(not r['tracked'] for r in rows),'qualityApproved':False,
         'note':'Feature tracking may drift and does not distinguish generated geometry changes from camera motion. Eye sharpness is only a crop-selection aid, affected by blinks and texture; inspect consecutive crops and playback.'}
(args.render/'eyes-camera-diagnostics.json').write_text(json.dumps({'summary':summary,'frames':rows},indent=2))
print(json.dumps(summary))
