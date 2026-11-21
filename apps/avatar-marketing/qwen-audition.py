"""Render the fixed Alex CustomVoice speaker under Signal's existing supervisor."""
from alex_activity_guard import generation_authorized
import argparse
import hashlib
import json
import os
import random
import time
from pathlib import Path


def synthesize(args, root):
    briefs = json.loads(args.briefs.read_text(encoding='utf-8-sig'))
    brief = next(b for b in briefs if b['id'] == args.id)
    if not args.id or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.id):
        raise ValueError('Use a plain brief identifier.')
    if not 1 <= len(brief['script']) <= 650:
        raise ValueError('Use a bounded complete speech take of up to 650 characters.')
    render_voice(args, root, brief)


def main():
    if not generation_authorized(require_owned=True): raise RuntimeError('Generation paused, outside window, or not supervised.')
    parser = argparse.ArgumentParser()
    parser.add_argument('briefs', type=Path)
    parser.add_argument('--id', required=True)
    parser.add_argument('--take', type=int, default=42)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    lock = root / 'output/alex-creator/renders/render.lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        handle = lock.open('x', encoding='utf-8')
    except FileExistsError:
        raise RuntimeError('Finish the owned GPU job before loading the voice model.') from None
    try:
        with handle:
            handle.write(json.dumps(dict(pid=os.getpid(), stage='qwen-voice')))
            handle.flush()
            synthesize(args, root)
    finally:
        lock.unlink()


def render_voice(args, root, brief):
    if not generation_authorized(require_owned=True): raise RuntimeError('Generation paused, outside window, or not supervised.')
    model_dir = root / 'data/avatar-runtime/qwen-customvoice'
    installed = json.loads((model_dir / 'model-receipt.json').read_text(encoding='utf-8-sig'))
    if installed['revision'] != '0c0e3051f131929182e2c023b9537f8b1c68adfe' or not installed['verified']:
        raise RuntimeError('The approved voice model revision is not installed.')
    for item in installed['files']:
        path = (model_dir / item['path']).resolve()
        if not path.is_relative_to(model_dir.resolve()) or path.stat().st_size != item['bytes']:
            raise RuntimeError('The installed voice checkpoint changed.')
        with path.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() != item['sha256']:
                raise RuntimeError('The installed voice checkpoint hash changed.')
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel
    torch.set_num_threads(2)
    torch.manual_seed(args.take)
    random.seed(args.take)
    np.random.seed(args.take)
    folder = root / 'output/alex-creator/voice' / args.id
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f'ryan-{args.take}.wav'
    if output.exists():
        raise FileExistsError('Keep earlier voice takes; choose a new take seed.')
    started = time.monotonic()
    model = Qwen3TTSModel.from_pretrained(str(model_dir),
        device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa', low_cpu_mem_usage=True)
    print('Synthesizing Alex voice: ' + args.id, flush=True)
    with torch.inference_mode():
        wavs, rate = model.generate_custom_voice(text=brief['script'], speaker='Ryan', language='English',
            instruct=brief['voiceDirection'], max_new_tokens=700, do_sample=True, temperature=0.8,
            top_p=0.9, repetition_penalty=1.05)
    samples = np.asarray(wavs[0], dtype=np.float32).squeeze()
    if not np.isfinite(samples).all() or samples.size < rate or samples.size > 45 * rate:
        raise RuntimeError('Invalid or unexpectedly long speech output.')
    sf.write(output, samples, rate, subtype='PCM_16')
    receipt = dict(id=args.id, model='Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
        modelRevision='0c0e3051f131929182e2c023b9537f8b1c68adfe', speaker='Ryan', language='English',
        text=brief['script'], instruct=brief['voiceDirection'], seed=args.take,
        audio=str(output), sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
        sampleRate=rate, durationSeconds=len(samples)/rate, peakAmplitude=float(np.abs(samples).max()),
        rmsAmplitude=float(np.sqrt(np.mean(samples**2))), elapsedSeconds=time.monotonic()-started,
        peakGpuAllocatedBytes=torch.cuda.max_memory_allocated(), qualityApproved=False,
        listeningReviewRequired=True, attention='sdpa', precision='bfloat16')
    output.with_suffix('.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
