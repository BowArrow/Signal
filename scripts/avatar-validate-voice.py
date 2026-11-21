"""Independent local transcript and signal checks; does not judge speaker likeness."""
import argparse
import difflib
import json
from pathlib import Path
import re

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('audio', type=Path)
    args = p.parse_args()
    audio = args.audio.resolve()
    receipt = json.loads(audio.with_suffix('.json').read_text())
    model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=2, local_files_only=True)
    segments, info = model.transcribe(str(audio), language='en', beam_size=5, vad_filter=True, condition_on_previous_text=False)
    segments = [{'start': s.start, 'end': s.end, 'text': s.text} for s in segments]
    actual = ' '.join(s['text'].strip() for s in segments)
    normalize = lambda text: re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower())
    expected_words, actual_words = normalize(receipt['text']), normalize(actual)
    similarity = difflib.SequenceMatcher(a=expected_words, b=actual_words).ratio()
    samples, rate = sf.read(audio)
    validation = {'audio': str(audio), 'automaticTranscript': actual, 'segments': segments,
                  'expectedText': receipt['text'], 'wordSequenceSimilarity': similarity,
                  'durationSeconds': len(samples) / rate, 'peakAmplitude': float(np.abs(samples).max()),
                  'rmsAmplitude': float(np.sqrt(np.mean(samples ** 2))),
                  'allSamplesFinite': bool(np.isfinite(samples).all()),
                  'speakerIdentityAndCadence': 'Requires listening comparison by the owner',
                  'qualityApproved': False}
    audio.with_name(audio.stem + '-validation.json').write_text(json.dumps(validation, indent=2), encoding='utf-8')
    print(json.dumps(validation), flush=True)
