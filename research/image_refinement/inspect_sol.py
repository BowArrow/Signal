"""Pin source and component metadata without downloading or executing SoL weights."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

CODE_REV = '670482d8a857d578ac8a2ea89b052d0fb47badba'
MODEL_REV = 'c69c2a543997fe12c1ae24c776df6188e5d2248a'
MODEL = 'Efficient-Large-Model/SoL-Refiner-LTX-2.3-One-Step'


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'Signal-Research/1.0'}), timeout=30) as response:
        data = response.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError('Metadata/source exceeded size limit')
    return data


def main(output):
    output.mkdir(parents=True, exist_ok=False)
    sources = []
    files = ['README.md', 'LTX-2.3/README.md', 'LTX-2.3/infer.py',
             'LTX-2.3/requirements.txt', 'LTX-2.3/sol_refiner/pipeline.py',
             'LTX-2.3/sol_refiner/sampling.py', 'LTX-2.3/sol_refiner/optimization.py',
             'LTX-2.3/sol_refiner/fusion.py', 'LTX-2.3/sol_refiner/sol_attention.py',
             'MiniMax-H3/README.md']
    for name in files:
        url = f'https://raw.githubusercontent.com/NVlabs/Sana/{CODE_REV}/models/sol-refiner/{name}'
        data = fetch(url)
        destination = output / 'source' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        sources.append({'path': name, 'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
    api = f'https://huggingface.co/api/models/{MODEL}/revision/{MODEL_REV}?blobs=true'
    metadata = json.loads(fetch(api))
    (output / 'model-metadata.json').write_text(json.dumps(metadata, indent=2))
    components = {}
    for file in metadata['siblings']:
        if file['rfilename'].endswith('.safetensors'):
            component = file['rfilename'].split('/')[0]
            components[component] = components.get(component, 0) + file['size']
    indices = {}
    for component in ['transformer', 'connectors', 'text_encoder']:
        name = 'model.safetensors.index.json' if component == 'text_encoder' else 'diffusion_pytorch_model.safetensors.index.json'
        url = f'https://huggingface.co/{MODEL}/resolve/{MODEL_REV}/{component}/{name}'
        index = json.loads(fetch(url))
        (output / f'{component}-index.json').write_text(json.dumps(index, indent=2))
        indices[component] = index['metadata']
    result = {'code_revision': CODE_REV, 'model_revision': MODEL_REV,
              'component_safetensors_bytes_including_headers': components,
              'index_metadata': indices, 'sources': sources,
              'total_weights_gib': sum(components.values()) / 1024 ** 3,
              'weights_downloaded': False, 'inference_tested': False,
              'license_status': 'No README or license file in pinned weight tree; upstream terms need resolution.'}
    (output / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k != 'sources'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    main(parser.parse_args().output)
