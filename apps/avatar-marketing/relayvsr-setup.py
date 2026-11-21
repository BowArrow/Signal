"""Install pinned RelayVSR assets without importing Torch or changing the LTX environment."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

REVISION = 'ba556c9fab83606eb82285b7eb3a9375232744b6'
MODELS = [
    ('diffusion_models/relayvsr_x2_lightx2v_int8_convrot.safetensors', 5163295248, '240e75e0c17cf2845d559b25254a230ff7458f81449d7a8c5e7e3fb8275c7b3c'),
    ('vae/relayvsr_flash_vae_x2_fp32.safetensors', 127759464, 'b5bb0339acb5b52545911ea29a51b4c5b805776a779222b5a14591571f42e21c'),
]

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--dependencies', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.dependencies:
        subprocess.run([sys.executable, '-s', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--target', str(root/'site'), 'comfy-aimdo==0.6.0', 'comfy-kitchen==0.2.41'], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        return
    receipt = []
    for name, size, sha in MODELS:
        path = root/'models'/name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            partial = path.with_suffix('.partial')
            offset = partial.stat().st_size if partial.exists() else 0
            request = urllib.request.Request(f'https://huggingface.co/Comfy-Org/RelayVSR/resolve/{REVISION}/{name}', headers={'Range':f'bytes={offset}-'} if offset else {})
            with urllib.request.urlopen(request, timeout=60) as response:
                append = offset > 0 and response.status == 206
                if not append: offset = 0
                last = offset
                with partial.open('ab' if append else 'wb') as output:
                    while block := response.read(4 * 1024 * 1024):
                        offset += len(block)
                        if offset > size: raise RuntimeError('Download exceeds pinned size.')
                        output.write(block)
                        if offset-last >= 256*1024*1024:
                            print(json.dumps({'file':name,'bytes':offset,'total':size}), flush=True)
                            last=offset
            if partial.stat().st_size != size or digest(partial) != sha:
                raise RuntimeError('Pinned model verification failed: '+name)
            partial.rename(path)
        if path.stat().st_size != size or digest(path) != sha:
            raise RuntimeError('Installed model changed: '+name)
        receipt.append({'file':name,'bytes':size,'sha256':sha})
        print(json.dumps({'verified':name}), flush=True)
    (root/'model-receipt.json').write_text(json.dumps({'repository':'Comfy-Org/RelayVSR','revision':REVISION,'verified':True,'models':receipt}, indent=2))

if __name__ == '__main__':
    main()
