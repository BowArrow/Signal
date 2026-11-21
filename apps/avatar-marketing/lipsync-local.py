"""Supervised MuseTalk mouth refinement of an existing Alex LTX shot."""
import argparse
import gc
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('render', type=Path)
    args = parser.parse_args()
    source = args.render.resolve()
    spec = importlib.util.spec_from_file_location('muse_bounded', ROOT/'scripts/avatar-musetalk-smoke.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    receipt = json.loads((source/'receipt.json').read_text())
    if not receipt['decodeVerified'] or module.sha(source/'video.mp4') != receipt['videoSha256']:
        raise ValueError('Source video is not the unchanged decoded LTX take.')
    if module.sha(source/'input-audio.wav') != receipt['conditionedAudioSha256']:
        raise ValueError('Conditioned voice changed.')
    output = source/'lipsync-v1'
    output.mkdir(exist_ok=True)
    if (output/'video.mp4').exists():
        raise ValueError('Refusing to overwrite an existing lipsync review.')
    lockpath = ROOT/'output/alex-creator/renders/render.lock'
    with lockpath.open('x') as lock:
        lock.write(json.dumps({'pid':os.getpid(),'stage':'musetalk','at':time.time()}))
    try:
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
        # Verify the already installed lip-sync model pack before inference.
        model_rows = [r for r in json.loads((ROOT/'data/avatar-runtime/model-receipt.json').read_text())
                      if 'MuseTalk' in r['path']]
        if not model_rows:
            raise ValueError('Missing model pack receipt.')
        for row in model_rows:
            if module.sha(ROOT/row['path']) != row['sha256']:
                raise ValueError('Lip-sync model pack changed: '+row['file'])
        module.OUT = output
        module.SOURCE = source/'video.mp4'
        module.FRAMES = output/'frames'
        module.COORDS = output/'coordinates.json'
        module.FRAMES.mkdir(exist_ok=True)
        os.chdir(module.RUNTIME)
        sys.path.insert(0,str(module.RUNTIME))
        import torch
        import cv2
        torch.set_num_threads(2)
        cv2.setNumThreads(2)
        native = next(s for s in receipt['info']['streams'] if s['codec_type']=='video')
        numerator, denominator = map(int,native['r_frame_rate'].split('/'))
        fps = numerator/denominator
        if fps != int(fps) or fps not in (24,25,30):
            raise ValueError('Use an integer frame rate supported by this review path.')
        subprocess.run([str(module.FFMPEG),'-v','error','-i',str(module.SOURCE),
                        '-start_number','0',str(module.FRAMES/'%06d.png')],check=True)
        paths = sorted(module.FRAMES.glob('*.png'))
        from musetalk.utils import preprocessing as prep
        boxes = []
        for offset in range(0,len(paths),8):
            found, frames = prep.get_landmark_and_bbox([str(p) for p in paths[offset:offset+8]],0)
            for bbox,frame in zip(found,frames):
                x1,y1,x2,y2 = map(int,bbox)
                y2 = min(y2+10,frame.shape[0])
                if not(0<=x1<x2<=frame.shape[1] and 0<=y1<y2<=frame.shape[0]):
                    raise ValueError('Face detection failed; refusing untracked mouth replacement.')
                boxes.append([x1,y1,x2,y2])
            del frames
        if len(boxes)!=len(paths):
            raise ValueError('Face/source pairing mismatch.')
        module.COORDS.write_text(json.dumps({'sourceSha256':receipt['videoSha256'],'fps':int(fps),'boxes':boxes}))
        shutil.copyfile(source/'input-audio.wav',output/'input-audio.wav')
        del prep.model, prep.fa
        gc.collect()
        torch.cuda.empty_cache()
        module.render(source/'input-audio.wav','video',0,'mouth',stabilize=True,latent_mode='mean',normalize_audio=False)
        result = json.loads((output/'video.json').read_text())
        if result['frames']!=len(paths):
            raise ValueError('Refinement changed the frame count.')
        result.update(sourceRenderReceipt=str(source/'receipt.json'),
                      method='LTX motion with MuseTalk mouth-only refinement',
                      sourceAudioSha256=receipt['sourceAudioSha256'],
                      modelReceipts=model_rows,qualityApproved=False,published=False)
        (output/'receipt.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({'saved':True,'video':result['output'],'qualityApproved':False}))
    finally:
        lockpath.unlink()


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8',errors='replace')
    sys.stderr.reconfigure(encoding='utf-8',errors='replace')
    main()
