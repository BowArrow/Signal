"""Separate ComfyUI checkout and dependency overlay, inside the Windows limiter."""
from pathlib import Path
import runpy
import sys

root = Path(sys.argv[1]).resolve()
main = root/'ComfyUI/main.py'
sys.path[:0] = [str(root/'site'), str(main.parent)]
sys.argv = [str(main), *sys.argv[2:]]
import comfy.options
comfy.options.enable_args_parsing()
import cuda_malloc
import comfy_aimdo.control
if not comfy_aimdo.control.init(simple_vram_headroom=int(5.5*1024**3), nvml_pressure=True):
    raise RuntimeError('Dynamic allocator could not initialize.')
import comfy.model_management
comfy.model_management.MAX_PINNED_MEMORY = min(comfy.model_management.MAX_PINNED_MEMORY, 512*1024**2)
runpy.run_path(str(main), run_name='__main__')
