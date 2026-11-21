"""Fetch and verify the official INT8 development transformer for quality trials."""
import hashlib
import json
import os
import time
from pathlib import Path
import requests
from huggingface_hub import get_token

REPO = 'Lightricks/LTX-2.5'
REVISION = '49b093a39c19169a8a81721dcc541e07e945232f'
FILE = 'diffusion_models/ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors'
SIZE = 21504034224
SHA = '2edbdb4465cd6c3b532cd67a31ddb38a63e97dcad20be3729675e2a4e8caf92b'


def main():
    root = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/ltx25-models'
    dest = root / FILE
    part = dest.with_suffix('.download')
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        offset = part.stat().st_size if part.exists() else 0
        headers = {}
        token = get_token()
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if offset:
            headers['Range'] = f'bytes={offset}-'
        url = f'https://huggingface.co/{REPO}/resolve/{REVISION}/{FILE}?download=true'
        with requests.get(url, headers=headers, stream=True, timeout=(30, 90)) as response:
            if response.status_code not in (200, 206):
                raise RuntimeError(f'Model download HTTP {response.status_code}; credentials are not printed.')
            if offset and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                raise RuntimeError('Server did not honor the partial download offset.')
            written = offset
            logged = 0
            with part.open('ab' if offset else 'wb') as handle:
                for chunk in response.iter_content(4 * 1024 * 1024):
                    written += len(chunk)
                    if written > SIZE:
                        raise RuntimeError('Download exceeds the pinned size.')
                    handle.write(chunk)
                    if time.monotonic() - logged > 30:
                        print(json.dumps(dict(stage='downloading',bytes=written,totalBytes=SIZE,percent=round(100*written/SIZE,1))),flush=True)
                        logged = time.monotonic()
    target = dest if dest.exists() else part
    if target.stat().st_size != SIZE:
        raise RuntimeError('Incomplete model download; rerun to resume.')
    with target.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != SHA:
            raise RuntimeError('Checkpoint checksum mismatch.')
    if target == part:
        part.replace(dest)
    receipt = dict(repo=REPO,revision=REVISION,file=FILE,bytes=SIZE,sha256=SHA,verified=True)
    (root / 'alex-guided-model-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(dict(stage='verified',**receipt)),flush=True)


if __name__ == '__main__':
    main()
