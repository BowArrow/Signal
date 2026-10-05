"""Download and verify the five selected LTX components using local HF login."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import HfApi, hf_hub_download, hf_hub_url, get_token

ROOT = Path(os.environ['LOCALAPPDATA']) / 'Signal' / 'runtime' / 'ltx25-models'
FILES = {
    'Winnougan/ltx-2.5-w4a8-convrot-int4-convrot-Winnougan-Blessing': [
        'diffusion_models/ltx-2.5-22b-distilled-transformer-w4a8_convrot.safetensors',
        'text_encoders/gemma4-12b-with-proj-ltx-2.5-w4a8_convrot.safetensors',
    ],
    'Lightricks/LTX-2.5': [
        'vae/ltx-2.5-video-vae-bf16.safetensors',
        'vae/ltx-2.5-audio-vae-bf16.safetensors',
        'latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors',
    ],
}
ROOT.mkdir(parents=True, exist_ok=True)
api = HfApi()
inventory = []
for repo, names in FILES.items():
    info = api.model_info(repo, files_metadata=True)
    for name in names:
        entry = next(f for f in info.siblings if f.rfilename == name)
        if not entry.lfs or not entry.lfs.sha256 or not entry.size:
            raise RuntimeError('Missing upstream file integrity metadata: ' + name)
        inventory.append({'repo': repo, 'revision': info.sha, 'file': name, 'bytes': entry.size, 'sha256': entry.lfs.sha256})
missing = sum(f['bytes'] for f in inventory if not (ROOT / f['file']).exists())
if shutil.disk_usage(ROOT).free < missing + 8 * 1024**3:
    raise RuntimeError('Not enough disk space for model files and download headroom.')
print(json.dumps({'phase': 'downloading', 'files': len(inventory), 'bytes': sum(f['bytes'] for f in inventory)}), flush=True)
def ranged_download(entry):
    import requests
    target = ROOT / entry['file']
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix('.signal-part')
    state_file = target.with_suffix('.signal-ranges.json')
    chunk_size = 32 * 1024**2
    count = (entry['bytes'] + chunk_size - 1) // chunk_size
    completed = set()
    if partial.exists() and state_file.exists():
        state = json.loads(state_file.read_text())
        if state['sha256'] != entry['sha256'] or state['chunk_size'] != chunk_size:
            raise RuntimeError('Range download metadata changed.')
        completed = set(state['completed'])
    else:
        with open(partial, 'wb') as output:
            output.truncate(entry['bytes'])
    guard = threading.Lock()
    last_report = [0.0]
    token = get_token()
    url = hf_hub_url(entry['repo'], entry['file'], revision=entry['revision'])
    def part(index):
        if index in completed:
            return
        start = index * chunk_size
        end = min(entry['bytes'], start + chunk_size) - 1
        for attempt in range(5):
            try:
                with requests.get(url + f'?download=true&signal_range={start}-{end}', headers={'Authorization': 'Bearer ' + token, 'Range': f'bytes={start}-{end}'}, stream=True, timeout=(20, 40)) as response:
                    if response.status_code != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{entry["bytes"]}':
                        raise RuntimeError('Server did not return the requested byte range.')
                    written = 0
                    with open(partial, 'r+b') as output:
                        output.seek(start)
                        for data in response.iter_content(1024**2):
                            if written + len(data) > end - start + 1:
                                raise RuntimeError('Byte range exceeded expected length.')
                            output.write(data)
                            written += len(data)
                    if written != end - start + 1:
                        raise RuntimeError('Incomplete byte range.')
                with guard:
                    completed.add(index)
                    temporary = state_file.with_suffix('.tmp')
                    temporary.write_text(json.dumps({'sha256': entry['sha256'], 'chunk_size': chunk_size, 'completed': sorted(completed)}))
                    os.replace(temporary, state_file)
                    if time.monotonic() - last_report[0] > 20:
                        print(json.dumps({'file': entry['file'], 'chunks': len(completed), 'total': count}), flush=True)
                        last_report[0] = time.monotonic()
                return
            except Exception:
                if attempt == 4:
                    raise RuntimeError('Byte range download failed after retries: ' + str(index)) from None
                time.sleep(attempt + 1)
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(part, range(count)))
    return partial

def download(entry):
    path = ranged_download(entry) if os.environ.get('SIGNAL_HF_RANGES') == '1' else hf_hub_download(entry['repo'], entry['file'], revision=entry['revision'], local_dir=ROOT)
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(8 * 1024**2), b''):
            digest.update(chunk)
    if Path(path).stat().st_size != entry['bytes'] or digest.hexdigest() != entry['sha256']:
        raise RuntimeError('Model integrity check failed: ' + entry['file'])
    if Path(path) != ROOT / entry['file']:
        os.replace(path, ROOT / entry['file'])
    print(json.dumps({'verified': entry['file'], 'bytes': entry['bytes']}), flush=True)

with ThreadPoolExecutor(max_workers=1 if os.environ.get('SIGNAL_HF_RANGES') == '1' else 3) as pool:
    list(pool.map(download, inventory))
(ROOT / 'signal-model-receipt.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
print('LTX model files downloaded and verified. This does not verify generation.', flush=True)
