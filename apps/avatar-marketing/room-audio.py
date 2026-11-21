"""Reversible room treatment of approved speech. No GPU or voice re-synthesis."""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def peak(samples):
    return float(np.max(np.abs(signal.resample_poly(samples, 4, 1))))


def loudness(ffmpeg, path):
    result = subprocess.run([str(ffmpeg), '-hide_banner', '-i', str(path), '-af',
                             'loudnorm=I=-17:TP=-1.5:LRA=11:print_format=json',
                             '-f', 'null', '-'], capture_output=True, text=True, check=True)
    return json.JSONDecoder().raw_decode(result.stderr[result.stderr.rfind('{'):])[0]


def build(source, folder, config, expected_hash, align_samples=False):
    if digest(source) != expected_hash:
        raise ValueError('Approved source audio hash changed.')
    folder.mkdir(parents=True, exist_ok=False)
    settings = json.loads(config.read_text(encoding='utf-8-sig'))
    rate, pcm = wavfile.read(source)
    if rate != 24000 or pcm.dtype != np.int16 or pcm.ndim != 1:
        raise ValueError('Expected the approved 24 kHz mono PCM16 voice master.')
    dry = pcm.astype(np.float64) / 32768
    if len(dry) < rate or not np.any(dry):
        raise ValueError('Expected nonempty speech.')
    ffmpeg = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe'
    rng = np.random.default_rng(settings['seed'])
    # Causal filters and a direct path preserve the speech clock and onset.
    voice = signal.sosfilt(signal.butter(2, settings['highpassHz'], 'highpass', fs=rate, output='sos'), dry)
    voice = signal.sosfilt(signal.butter(2, settings['lowpassHz'], 'lowpass', fs=rate, output='sos'), voice)
    length = int(rate * settings['decaySeconds'])
    times = np.arange(length) / rate
    impulse = rng.normal(size=length) * np.exp(-6.907755 * times / settings['decaySeconds'])
    impulse[:int(.008 * rate)] = 0
    impulse = signal.sosfilt(signal.butter(2, 3500, fs=rate, output='sos'), impulse)
    impulse /= np.linalg.norm(impulse)
    for seconds, amount in [(0.012, .65), (.023, .45), (.039, .32), (.057, .2)]:
        impulse[round(seconds * rate)] += amount
    reflected = signal.fftconvolve(voice, impulse)[:len(voice)]
    reflected *= np.sqrt(np.mean(voice**2) / max(np.mean(reflected**2), 1e-20))
    treated = voice + reflected * 10**(settings['reflectionLevelDb'] / 20)
    bed = signal.sosfilt(signal.butter(2, [90, 3500], 'bandpass', fs=rate, output='sos'), rng.normal(size=len(dry)))
    bed *= 10**(settings['roomToneRmsDbfs'] / 20) / np.sqrt(np.mean(bed**2))
    # Very short boundary fades affect ambience only, never the spoken waveform.
    fade = min(round(.05 * rate), len(bed)//2)
    bed[:fade] *= np.linspace(0, 1, fade)
    bed[-fade:] *= np.linspace(1, 0, fade)
    treated += bed
    results = {}
    prepared = {}
    for name, samples in [('dry-matched', dry), ('room', treated)]:
        raw = folder / (name + '-float.wav')
        wavfile.write(raw, rate, samples.astype(np.float32))
        measured = loudness(ffmpeg, raw)
        input_lufs = float(measured['input_i'])
        maximum_gain = settings['maximumTruePeakDbfs'] - 20 * np.log10(max(peak(samples), 1e-12))
        prepared[name] = (samples, input_lufs, maximum_gain)
        raw.unlink()
    # Both versions share the lower attainable loudness without compression.
    matched_lufs = min(settings['targetLufs'], *(level + cap for _, level, cap in prepared.values()))
    for name, (samples, input_lufs, _) in prepared.items():
        gain_db = matched_lufs - input_lufs
        samples = samples * 10**(gain_db / 20)
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) >= 1:
            raise ValueError('Nonfinite or clipped mix.')
        path = folder / (name + '.wav')
        wavfile.write(path, rate, np.rint(samples * 32767).astype(np.int16))
        final = loudness(ffmpeg, path)
        results[name] = {'path':str(path.resolve()), 'sha256':digest(path), 'lufs':float(final['input_i']),
                         'truePeakDbfs':float(final['input_tp']), 'gainDb':float(gain_db)}
    # Detect any accidental time shift independently of the sample-count invariant.
    _, final_pcm = wavfile.read(folder / 'room.wav')
    corr = signal.correlate(final_pcm.astype(float), dry, mode='full', method='fft')
    lag = int(np.argmax(corr) - (len(dry) - 1))
    if len(final_pcm) != len(pcm) or abs(lag) > 2:
        raise ValueError('Room processing changed speech timing.')
    measured_lag = lag
    if align_samples and lag:
        # Correct the produced mix, never its receipt alone or the source master.
        # Integer delay/advance uses silence padding, not wraparound or resampling.
        # Require the replaced source boundary to contain no audible speech.
        boundary = dry[:lag] if lag > 0 else dry[lag:]
        if np.max(np.abs(boundary)) > 0.001:
            raise ValueError('Alignment correction would trim a non-silent source boundary.')
        aligned = np.zeros_like(final_pcm)
        if lag > 0:
            aligned[:-lag] = final_pcm[lag:]
        else:
            aligned[-lag:] = final_pcm[:lag]
        wavfile.write(folder / 'room.wav', rate, aligned)
        _, final_pcm = wavfile.read(folder / 'room.wav')
        corr = signal.correlate(final_pcm.astype(float), dry, mode='full', method='fft')
        lag = int(np.argmax(corr) - (len(dry) - 1))
        if len(final_pcm) != len(pcm) or lag != 0:
            raise ValueError('Corrected room mix did not achieve exact zero-sample alignment.')
        final = loudness(ffmpeg, folder / 'room.wav')
        results['room'].update(sha256=digest(folder / 'room.wav'),
                               lufs=float(final['input_i']), truePeakDbfs=float(final['input_tp']))
        if float(final['input_tp']) > settings['maximumTruePeakDbfs'] + 0.01:
            raise ValueError('Corrected room mix exceeded the existing peak ceiling.')
    if align_samples and lag != 0:
        raise ValueError('Room mix requires exact zero-sample alignment.')
    receipt = {'sourcePath':str(source.resolve()), 'sourceSha256':expected_hash,
               'profilePath':str(config.resolve()), 'profileSha256':digest(config), 'profile':settings,
               'sampleRate':rate, 'samples':len(pcm), 'durationSeconds':len(pcm)/rate,
               'alignmentLagSamples':lag, 'matchedTargetLufs':float(matched_lufs),
               'alignmentCorrection': {'requested':align_samples, 'measuredLagBeforeSamples':measured_lag,
                                       'appliedShiftSamples':-measured_lag if align_samples else 0,
                                       'method':'integer PCM shift with zero padding; same sample count'},
               'sourceUnchanged':digest(source)==expected_hash,
               'qualityApproved':False, 'outputs':results}
    (folder / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--profile', type=Path, default=Path('campaigns/alex-creator/room-audio.json'))
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--align-samples', action='store_true', help='Correct at most two samples of mix-filter lag and require exact zero alignment.')
    args = parser.parse_args()
    build(args.source, args.folder, args.profile, args.source_sha256, args.align_samples)
