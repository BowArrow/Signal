"""Fetch only the official pinned Ditto PyTorch inference assets."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data/avatar-runtime/Ditto/checkpoints'
REPO = 'digital-avatar/ditto-talkinghead'
REVISION = 'e4a2f60328ee7c32af585ac4b3cce299e4c8e254'

def fetch(item):
    path = Path(hf_hub_download(REPO, item.rfilename, revision=REVISION, local_dir=DEST))
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    assert path.stat().st_size == item.size
    expected = getattr(item.lfs, 'sha256', None)
    if expected and digest.hexdigest() != expected:
        raise RuntimeError(f'Checkpoint hash mismatch: {item.rfilename}')
    return {'file': item.rfilename, 'bytes': item.size, 'sha256': digest.hexdigest()}

if __name__ == '__main__':
    info = HfApi().model_info(REPO, revision=REVISION, files_metadata=True)
    files = [s for s in info.siblings if s.rfilename.startswith('ditto_pytorch/')
             or s.rfilename == 'ditto_cfg/v0.4_hubert_cfg_pytorch.pkl']
    receipt = {'repo': REPO, 'revision': REVISION, 'files': [],
               'purpose': 'private local quality evaluation; dependency model terms not cleared for production'}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in as_completed([pool.submit(fetch, item) for item in files]):
            row = future.result()
            receipt['files'].append(row)
            (DEST / 'download-receipt.json').write_text(json.dumps(receipt, indent=2))
            print(f'Verified {row["file"]}: {row["bytes"]} bytes', flush=True)
