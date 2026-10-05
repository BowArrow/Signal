"""CPU-only real-checkpoint check; run under limited_runtime.py --cpu-only."""
import json
import os
from pathlib import Path
import sys

root = Path(os.environ['APPDATA']) / 'signal/runtime/creative/comfy-owned-v1/ComfyUI'
sys.path.insert(0, str(root))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/core/video'))
sys.argv = [sys.argv[0], '--cpu']
import torch
from safetensors import safe_open
from comfy.ldm.lightricks.latent_upsampler import LatentUpsampler
from ltx_upscaler import install_meta_upscaler

class NoInit:
    class Conv2d(torch.nn.Conv2d):
        def reset_parameters(self): pass
    class Conv3d(torch.nn.Conv3d):
        def reset_parameters(self): pass
    class GroupNorm(torch.nn.GroupNorm):
        def reset_parameters(self): pass

path = Path(os.environ['LOCALAPPDATA']) / 'Signal/runtime/ltx25-models/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'
install_meta_upscaler(LatentUpsampler)
with safe_open(str(path), framework='pt', device='cpu') as checkpoint:
    config = json.loads(checkpoint.metadata()['config'])
    model = LatentUpsampler.from_config(config, NoInit).to(dtype=torch.bfloat16)
    assert all(t.is_meta for t in model.parameters())
    try:
        model.load_state_dict({}, assign=False)
        raise AssertionError('Non-assigning loader was not rejected')
    except RuntimeError as error:
        assert 'strict dynamic' in str(error)
    state = {key: checkpoint.get_tensor(key) for key in checkpoint.keys()}
    model.load_state_dict(state, assign=True)
    assert not any(t.is_meta for t in [*model.parameters(), *model.buffers()])
    assert all(t.dtype == torch.bfloat16 for t in model.parameters())
    assert all(model.state_dict()[key].data_ptr() == value.data_ptr() for key, value in state.items())
    print(json.dumps({'passed': True, 'tensors': len(state), 'allocatedDuplicateWeights': False, 'gpuUsed': False, 'config': config}))
