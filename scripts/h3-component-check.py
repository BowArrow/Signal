"""Isolated component diagnostic. Invoke through limited_runtime.py, never directly."""
import json
import os
from pathlib import Path
import sys
import time

root, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(root))
sys.argv = [str(root / 'main.py'), '--lowvram', '--fp16-vae', '--disable-pinned-memory',
            '--disable-dynamic-vram', '--disable-cuda-malloc', '--disable-async-offload',
            '--fast-disk', '--reserve-vram', '5']
import torch
import comfy.options
comfy.options.enable_args_parsing()
import comfy.sd
import comfy.utils
import psutil

torch.set_num_threads(2)
started = time.monotonic()
def report(stage, **extra):
    mem = psutil.Process().memory_info()
    value = dict(stage=stage, seconds=round(time.monotonic() - started, 2),
                 privateMiB=round(getattr(mem, 'private', mem.rss) / 2**20),
                 gpuMiB=round(torch.cuda.memory_allocated() / 2**20), **extra)
    print(json.dumps(value), flush=True)
    (output / 'component.json').write_text(json.dumps(value, indent=2), encoding='utf-8')

models = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/h3-models'
report('loading-quantized-vae')
weights = comfy.utils.load_torch_file(str(models / 'vae/minimax_h3_video_vae_int8_convrot.safetensors'), safe_load=True)
vae = comfy.sd.VAE(sd=weights)
del weights
report('vae-loaded', modelMiB=round(vae.model_size() / 2**20), dtype=str(vae.vae_dtype))
with torch.inference_mode():
    pixels = torch.full((1, 192, 320, 3), 0.5)
    latent = vae.encode(pixels)
    report('vae-encoded', latentShape=list(latent.shape))
    decoded = vae.decode(latent)
    if not torch.isfinite(decoded).all():
        raise RuntimeError('Nonfinite decoded values')
    report('vae-roundtrip-complete', outputShape=list(decoded.shape), minimum=float(decoded.min()), maximum=float(decoded.max()))
