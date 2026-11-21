"""Check generated words and save subtitle timings; listening quality is separate."""
import argparse
import difflib
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio', type=Path)
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    receipt = json.loads(args.audio.with_suffix('.json').read_text(encoding='utf-8'))
    model = WhisperModel('base.en', device='cpu', compute_type='int8', cpu_threads=2)
    segments, _ = model.transcribe(str(args.audio), language='en', beam_size=5,
        word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
    saved = [dict(start=s.start, end=s.end, text=s.text,
        words=[dict(start=w.start,end=w.end,text=w.word,probability=w.probability) for w in s.words]) for s in segments]
    actual = ' '.join(s['text'].strip() for s in saved)
    normalize = lambda text: re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower())
    expected_words, actual_words = normalize(receipt['text']), normalize(actual)
    similarity = difflib.SequenceMatcher(a=expected_words, b=actual_words).ratio()
    result = dict(audio=str(args.audio), expectedText=receipt['text'], automaticTranscript=actual,
        wordSequenceSimilarity=similarity, exactNormalizedMatch=expected_words==actual_words,
        segments=saved, qualityApproved=False, listeningReviewRequired=True)
    dest = args.audio.with_name(args.audio.stem+'-transcript.json')
    dest.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='segments'}), flush=True)


if __name__=='__main__':
    main()
