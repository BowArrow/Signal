"""LTX dynamic offload bootstrap, supervised by limited_runtime.py.

Uses upstream dynamic/read-only loading. Bounds pinned staging separately.
GPU headroom is a target plus a watchdog, not a hard allocation cap.
"""
from pathlib import Path
import runpy
import sys

main = Path(sys.argv[1]).resolve()
if main.name != 'main.py' or not main.is_file():
    raise RuntimeError('Expected the owned ComfyUI entry point.')
sys.path.insert(0, str(main.parent))
sys.argv = [str(main), *sys.argv[2:]]
for flag in ['--enable-dynamic-vram', '--bf16-vae', '--fast-disk']:
    if flag not in sys.argv:
        raise RuntimeError('Missing managed LTX setting: ' + flag)
for flag in ['--cpu-vae', '--disable-dynamic-vram', '--disable-cuda-malloc', '--disable-pinned-memory', '--disable-async-offload', '--lowvram']:
    if flag in sys.argv:
        raise RuntimeError('Conflicting legacy setting: ' + flag)

import comfy.options
comfy.options.enable_args_parsing()
# Initialize the allocator before Torch, matching the main entry point.
import cuda_malloc
import comfy_aimdo.control
# host_buffer captures control.lib at import time; initialize before importing
# model_management, just as ComfyUI main.py does.
if not comfy_aimdo.control.init(simple_vram_headroom=3 * 1024 ** 3, nvml_pressure=True):
    raise RuntimeError('The installed dynamic memory manager could not initialize.')
import comfy.model_management
comfy.model_management.MAX_PINNED_MEMORY = min(comfy.model_management.MAX_PINNED_MEMORY, 1024 ** 3)
from comfy.ldm.lightricks.latent_upsampler import LatentUpsampler
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ltx_upscaler import install_meta_upscaler
install_meta_upscaler(LatentUpsampler)
print('[Signal] LTX dynamic offload; pinned staging limited to 1 GiB.', flush=True)
runpy.run_path(str(main), run_name='__main__')
