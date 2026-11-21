"""Generate local review takes with the owner's reference voice, without uploading it."""
import argparse
import hashlib
import json
import random
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS

ROOT = Path(__file__).resolve().parents[1]
TEXT = "Hi, I'm Casey. I build tools to make everyday work easier. Let's walk through a real example, see the result, and decide whether it would help you."


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--take', choices=['natural', 'baseline'], default='natural')
    parser.add_argument('--script', type=Path)
    parser.add_argument('--name')
    args = parser.parse_args()
    torch.set_num_threads(2)
    torch.manual_seed(42)
    random.seed(42)
    np.random.seed(42)
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA voice runtime is required for this test.')
    out = ROOT / 'output/avatar-research/2026-10-19'
    reference = out / 'voice-reference-candidate.wav'
    name = args.name or f'casey-voice-{args.take}'
    if not name.replace('-', '').replace('_', '').isalnum():
        raise ValueError('Use a simple output name.')
    text = args.script.read_text(encoding='utf-8-sig').strip() if args.script else TEXT
    if not 1 <= len(text) <= 600:
        raise ValueError('Use 1-600 characters for this bounded voice test.')
    output = out / f'{name}.wav'
    settings = {'exaggeration': 0.4, 'cfg_weight': 0.35} if args.take == 'natural' else {'exaggeration': 0.5, 'cfg_weight': 0.5}
    start = time.monotonic()
    model = ChatterboxTTS.from_local(ROOT / 'data/avatar-runtime/chatterbox-models', device='cuda')
    audio = model.generate(text, audio_prompt_path=str(reference), temperature=0.7, **settings)
    samples = audio.squeeze().cpu().numpy()
    if samples.size == 0 or not np.isfinite(samples).all():
        raise RuntimeError('Voice output is empty or nonfinite.')
    sf.write(output, samples, model.sr, subtype='PCM_16')
    receipt = {'model': 'ResembleAI/chatterbox', 'text': text, 'seed': 42, 'settings': settings,
               'reference': str(reference), 'referenceSha256': hashlib.sha256(reference.read_bytes()).hexdigest(),
               'output': str(output), 'sampleRate': model.sr, 'durationSeconds': len(samples) / model.sr,
               'elapsedSeconds': time.monotonic() - start, 'gpuPeakAllocatedBytes': torch.cuda.max_memory_allocated(),
               'generatedSpeech': True, 'qualityApproved': False, 'listeningReviewRequired': True}
    output.with_suffix('.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
