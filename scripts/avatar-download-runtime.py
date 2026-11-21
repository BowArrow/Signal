"""Resumable ranged download of the two official, SHA-256-verified Windows wheels."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from pathlib import Path
import time
import requests

ROOT = Path(__file__).resolve().parents[1] / 'data/avatar-runtime/wheels'
SPECS = [
    ('cu124', 'torch-2.6.0+cu124-cp311-cp311-win_amd64.whl', '6a1fb2714e9323f11edb6e8abf7aad5f79e45ad25c081cde87681a18d99c29eb'),
    ('cu118', 'torch-2.0.1+cu118-cp310-cp310-win_amd64.whl', 'f58d75619bc96e4322343c030b893613701caa2d6db8017155da226c14171335'),
]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def download(spec):
    index, name, expected = spec
    ROOT.mkdir(parents=True, exist_ok=True)
    target = ROOT / name
    if target.exists() and digest(target) == expected:
        return
    url = f'https://download.pytorch.org/whl/{index}/{name.replace("+", "%2B")}'
    with requests.get(url, headers={'Range': 'bytes=0-0'}, timeout=30) as r:
        r.raise_for_status()
        if r.status_code != 206:
            raise RuntimeError('Server did not support bounded range downloads.')
        size = int(r.headers['Content-Range'].split('/')[-1])
    chunk_size = 32 * 1024 * 1024
    parts = ROOT / (name + '.parts')
    parts.mkdir(exist_ok=True)

    def part(i):
        start, end = i * chunk_size, min(size, (i + 1) * chunk_size) - 1
        path = parts / f'{i:04d}'
        if path.exists() and path.stat().st_size == end - start + 1:
            return i
        for attempt in range(3):
            try:
                with requests.get(url, headers={'Range': f'bytes={start}-{end}'}, stream=True, timeout=(20, 60)) as r:
                    r.raise_for_status()
                    if r.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                        raise RuntimeError('Mismatched download range.')
                    with path.with_suffix('.partial').open('wb') as f:
                        for data in r.iter_content(1024 * 1024):
                            f.write(data)
                if path.with_suffix('.partial').stat().st_size != end - start + 1:
                    raise RuntimeError('Truncated download range.')
                path.with_suffix('.partial').replace(path)
                return i
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    count = (size + chunk_size - 1) // chunk_size
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(part, i) for i in range(count)]
        for done, future in enumerate(as_completed(futures), 1):
            future.result()
            print(f'{name}: {done}/{count} chunks', flush=True)
    with target.with_suffix('.partial').open('wb') as dest:
        for i in range(count):
            with (parts / f'{i:04d}').open('rb') as src:
                for b in iter(lambda: src.read(1024 * 1024), b''):
                    dest.write(b)
    if digest(target.with_suffix('.partial')) != expected:
        raise RuntimeError('Official wheel hash did not match.')
    target.with_suffix('.partial').replace(target)
    print(f'VERIFIED {name}', flush=True)


if __name__ == '__main__':
    for spec in SPECS:
        download(spec)
