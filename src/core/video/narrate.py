"""Local stock-voice narration, under Signal's CPU-only Windows job cap."""
import json
import os
from pathlib import Path
import re
import sys
import wave

os.environ['OMP_NUM_THREADS'] = '2'
os.environ['OPENBLAS_NUM_THREADS'] = '2'
os.environ['ONNX_PROVIDER'] = 'CPUExecutionProvider'


def narrate():
    spec_path = Path(sys.argv[1]).resolve()
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    text = spec['text'].strip()
    voice = spec['voice']
    if not 3 <= len(text) <= 900 or voice not in ['af_heart', 'am_michael', 'bf_emma', 'bm_george'] or not 0.8 <= spec['speed'] <= 1.2 or not 1 <= spec['maximumSeconds'] <= 60:
        raise ValueError('Invalid narration text, voice, speed or duration.')
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry('session.intra_op.allow_spinning', '0')
    options.add_session_config_entry('session.inter_op.allow_spinning', '0')
    root = Path(spec['runtime'])
    session = ort.InferenceSession(str(root / 'kokoro-v1.0.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    kokoro = Kokoro.from_session(session, str(root / 'voices-v1.0.bin'))
    # Bound each inference and retain exact audio-derived sentence cue times.
    sentences = re.split(r'(?<=[.!?])\s+', re.sub(r'\s+', ' ', text))
    chunks = []
    for sentence in sentences:
        while len(sentence) > 220:
            split = sentence.rfind(' ', 0, 220)
            if split < 1:
                raise ValueError('Use ordinary spaced words in the narration.')
            chunks.append(sentence[:split])
            sentence = sentence[split:].strip()
        if sentence:
            chunks.append(sentence)
    pieces = []
    cues = []
    total = 0
    for chunk in chunks:
        samples, rate = kokoro.create(chunk, voice=voice, speed=spec['speed'], lang='en-gb' if voice.startswith('b') else 'en-us')
        if rate != 24000 or not len(samples) or not np.isfinite(samples).all():
            raise ValueError('Narration did not produce valid audio.')
        start = total / rate
        total += len(samples)
        if total / rate > spec['maximumSeconds']:
            raise ValueError('Narration is longer than the edit. Shorten the script or use a longer edit.')
        cues.append({'text': chunk, 'start': start, 'end': total / rate})
        pieces.append(samples)
    audio = np.concatenate(pieces)
    with wave.open(str(spec_path.parent / 'narration.wav'), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    result = {'duration': total / 24000, 'sampleRate': 24000, 'voice': voice, 'cues': cues, 'providers': session.get_providers(), 'threads': 2}
    (spec_path.parent / 'narration.json').write_text(json.dumps(result), encoding='utf-8')
    print(json.dumps({'narrated': True, 'duration': result['duration'], 'providers': result['providers']}), flush=True)


if __name__ == '__main__':
    narrate()
