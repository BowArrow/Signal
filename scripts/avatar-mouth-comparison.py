"""Build a synchronized six-second review of local mouth-render experiments."""
import json
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/avatar-research/2026-10-19'
BIN = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin'
names = ['casey-avatar-v1', 'casey-avatar-lowerface', 'casey-avatar-stable']
labels = ['A - First version', 'B - Wider blend', 'C - Wider + stabilized']
parser = argparse.ArgumentParser()
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--ditto', action='store_true')
mode.add_argument('--calibrated', action='store_true')
mode.add_argument('--camera', action='store_true')
args = parser.parse_args()
output_name = 'casey-mouth-comparison'
if args.ditto:
    names = ['casey-avatar-lowerface', 'casey-avatar-ditto']
    labels = ['Previous wider blend', 'New full-expression test']
    output_name = 'casey-ditto-comparison'
if args.calibrated:
    names = ['casey-avatar-ditto', 'casey-avatar-calibrated']
    labels = ['Previous expression test', 'Calibrated + recorded eyes']
    output_name = 'casey-calibrated-comparison'
if args.camera:
    names = ['casey-avatar-calibrated', 'casey-avatar-camera']
    labels = ['Previous calibrated test', 'Softer mouth + camera gaze']
    output_name = 'casey-camera-comparison'
command = [str(BIN / 'ffmpeg.exe'), '-v', 'error', '-y']
for name in names:
    command += ['-i', str(OUT / f'{name}.mp4')]
filters = []
for i, label in enumerate(labels):
    filters.append(f"[{i}:v]trim=duration=6,setpts=PTS-STARTPTS,crop=360:450:330:90,scale=384:480,"
                   f"pad=384:520:0:40:color=0x151515,drawtext=font=Arial:text='{label}':"
                   f"fontcolor=white:fontsize=20:x=(w-tw)/2:y=10[v{i}]")
filters.append(''.join(f'[v{i}]' for i in range(len(names))) + f'hstack=inputs={len(names)}[out]')
output = OUT / f'{output_name}.mp4'
command += ['-filter_complex', ';'.join(filters), '-map', '[out]', '-map', '0:a:0',
            '-t', '6', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-c:a', 'copy', '-movflags', '+faststart', str(output)]
subprocess.run(command, check=True)
subprocess.run([str(BIN / 'ffmpeg.exe'), '-v', 'error', '-i', str(output), '-f', 'null', 'NUL'], check=True)
subprocess.run([str(BIN / 'ffmpeg.exe'), '-v', 'error', '-y', '-ss', '1', '-i', str(output),
                '-frames:v', '1', str(OUT / f'{output_name}.jpg')], check=True)
checks = {}
for name in [*names[1:], output_name]:
    probe = json.loads(subprocess.check_output([str(BIN / 'ffprobe.exe'), '-v', 'error',
                        '-show_streams', '-of', 'json', str(OUT / f'{name}.mp4')]))
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    assert int(video['nb_frames']) == 150
    assert abs(float(video['duration']) - float(audio['duration'])) < .04
    checks[name] = {'frames': int(video['nb_frames']), 'videoDuration': video['duration'],
                    'audioDuration': audio['duration'], 'qualityApproved': False}
(OUT / f'{output_name}-validation.json').write_text(json.dumps(checks, indent=2))
print(json.dumps(checks, indent=2))
