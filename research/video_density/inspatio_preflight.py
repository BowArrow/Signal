"""Read bounded checkpoint metadata; estimate known tensors without loading a model.

This is not a measured VRAM peak or a guarantee that inference fits.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct
from urllib.request import Request, urlopen

REVISION = '6a5cf5e27b8a05930911a5416fa8c68eabdda414'
SOURCE_REVISION = 'dd3561f544053fe22d739b6b2f8461c9c97bf8cb'
URL = f'https://huggingface.co/inspatio/world-1.5/resolve/{REVISION}/InSpatio-World-1.5-1.3B.safetensors'


def inspect(output):
    if output.exists():
        raise ValueError('Use a new output path.')
    limit = 2 * 1024 * 1024
    request = Request(URL, headers={'Range': f'bytes=0-{limit - 1}', 'User-Agent': 'Signal-Research-Metadata/1.0'})
    with urlopen(request, timeout=30) as response:
        prefix = response.read(8)
        if len(prefix) != 8:
            raise ValueError('Incomplete checkpoint prefix.')
        header_bytes = struct.unpack('<Q', prefix)[0]
        if not 2 <= header_bytes <= limit - 8:
            raise ValueError('Checkpoint metadata exceeds bounded probe.')
        header = response.read(header_bytes)
        if len(header) != header_bytes:
            raise ValueError('Incomplete checkpoint metadata.')
    # The stream is closed here; no tensor payload is saved or loaded.
    metadata = json.loads(header)
    dtypes = Counter()
    storage_bytes = 0
    for key, tensor in metadata.items():
        if key == '__metadata__':
            continue
        dtypes[tensor['dtype']] += math.prod(tensor['shape'])
        storage_bytes += tensor['data_offsets'][1] - tensor['data_offsets'][0]
    parameters = sum(dtypes.values())
    # Source: pinned scene_schema.py + causal_inference.py + Wan 1.3B config.
    tokens_per_frame = (480 // 8) * (832 // 8) // 4
    cache_tokens = tokens_per_frame * 3 * 2
    kv_bytes = 30 * 2 * cache_tokens * 1536 * 2
    weights_bf16_bytes = parameters * 2
    result = {
        'source_revision': SOURCE_REVISION, 'checkpoint_revision': REVISION,
        'checkpoint_url': URL, 'header_sha256': hashlib.sha256(header).hexdigest(),
        'metadata_bytes_read': header_bytes + 8, 'tensor_payload_saved': False,
        'tensor_elements_by_dtype': dict(dtypes), 'tensor_elements_total': parameters,
        'stored_tensor_bytes': storage_bytes, 'bf16_tensor_bytes_estimate': weights_bf16_bytes,
        'batch_one_kv_cache_bytes': kv_bytes,
        'known_weights_plus_kv_gib': (weights_bf16_bytes + kv_bytes) / 1024 ** 3,
        'kv_formula': '30 layers * 2 K/V * (1560 tokens/frame * 3 latent frames/block * 2) * 1536 width * 2 bytes',
        'excluded': ['VAE', 'text encoder', 'activations', 'attention workspaces', 'compile pools',
                     'condition latents', 'driver/context', 'renderer', 'other desktop applications'],
        'fit_verified': False, 'generation_tested': False, 'license_status': 'weights terms unresolved; code Apache-2.0; default depth model CC-BY-NC-4.0',
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    inspect(parser.parse_args().output)
