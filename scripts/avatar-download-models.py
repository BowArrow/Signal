"""Download pinned public avatar checkpoints; retain a hash/terms receipt."""
import hashlib
import json
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'data/avatar-runtime'
SPECS = [
    ('ResembleAI/chatterbox', 'chatterbox-models', ['ve.safetensors', 't3_cfg.safetensors', 's3gen.safetensors', 'tokenizer.json', 'conds.pt']),
    ('TMElyralab/MuseTalk', 'MuseTalk/models', ['musetalkV15/musetalk.json', 'musetalkV15/unet.pth']),
    ('stabilityai/sd-vae-ft-mse', 'MuseTalk/models/sd-vae', ['config.json', 'diffusion_pytorch_model.bin']),
    ('openai/whisper-tiny', 'MuseTalk/models/whisper', ['config.json', 'pytorch_model.bin', 'preprocessor_config.json']),
    ('yzd-v/DWPose', 'MuseTalk/models/dwpose', ['dw-ll_ucoco_384.pth']),
    ('ManyOtherFunctions/face-parse-bisent', 'MuseTalk/models/face-parse-bisent', ['79999_iter.pth', 'resnet18-5c106cde.pth']),
]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


if __name__ == '__main__':
    api = HfApi()
    receipt_path = RUNTIME / 'model-receipt.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else []
    for repo, folder, files in SPECS:
        info = api.model_info(repo)
        for name in files:
            old = next((row for row in receipt if row['repo'] == repo and row['file'] == name), None)
            revision = old['revision'] if old else info.sha
            print(f'Downloading {repo}/{name} at {revision}', flush=True)
            path = Path(hf_hub_download(repo_id=repo, filename=name, revision=revision, local_dir=RUNTIME / folder))
            row = {'repo': repo, 'revision': revision, 'file': name, 'path': str(path.relative_to(ROOT)),
                   'bytes': path.stat().st_size, 'sha256': digest(path),
                   'declaredLicense': getattr(info.card_data, 'license', None),
                   'source': f'https://huggingface.co/{repo}/tree/{revision}'}
            receipt = [r for r in receipt if not (r['repo'] == repo and r['file'] == name)] + [row]
            receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
            print(f'Saved {name}: {row["bytes"]} bytes', flush=True)
