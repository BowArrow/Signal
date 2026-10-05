"""Signal's local H3 stage checkpoints: tensors and JSON only, never pickle/code."""
import hashlib
import json
import os
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file
from comfy.nested_tensor import NestedTensor


def folder():
    value = os.environ.get('SIGNAL_H3_STAGE_DIR')
    if not value:
        raise RuntimeError('Signal H3 checkpoint directory is not configured.')
    path = Path(value).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def save_stage(name, value):
    tensors = {}
    def pack(item, depth=0):
        if depth > 32:
            raise ValueError('Checkpoint nesting is too deep.')
        if isinstance(item, torch.Tensor):
            key = str(len(tensors))
            tensors[key] = item.detach().cpu().contiguous().clone()
            return {'tensor': key}
        if isinstance(item, NestedTensor):
            return {'nested': [pack(t, depth + 1) for t in item.tensors]}
        if isinstance(item, dict) and all(isinstance(k, str) for k in item):
            return {'dict': {k: pack(v, depth + 1) for k, v in item.items()}}
        if isinstance(item, (list, tuple)):
            return {'tuple' if isinstance(item, tuple) else 'list': [pack(v, depth + 1) for v in item]}
        if item is None or isinstance(item, (str, int, float, bool)):
            return {'value': item}
        raise TypeError('Unsupported H3 checkpoint value: ' + type(item).__name__)
    tree = pack(value)
    if sum(t.numel() * t.element_size() for t in tensors.values()) > 512 * 1024**2:
        raise ValueError('Checkpoint exceeds 512 MiB.')
    root = folder(); temporary = root / (name + '.tmp'); target = root / (name + '.safetensors')
    save_file(tensors, str(temporary), metadata={'signal_h3_stage': '1', 'tree': json.dumps(tree, allow_nan=False)})
    os.replace(temporary, target)
    (root / (name + '.sha256')).write_text(digest(target), encoding='ascii')


def load_stage(name):
    root = folder(); path = root / (name + '.safetensors')
    if path.stat().st_size > 513 * 1024**2 or digest(path) != (root / (name + '.sha256')).read_text(encoding='ascii'):
        raise ValueError('H3 checkpoint integrity check failed.')
    with safe_open(str(path), framework='pt', device='cpu') as handle:
        metadata = handle.metadata()
        if metadata.get('signal_h3_stage') != '1':
            raise ValueError('Unsupported H3 checkpoint format.')
        def unpack(item, depth=0):
            if depth > 32 or not isinstance(item, dict) or len(item) != 1:
                raise ValueError('Invalid H3 checkpoint tree.')
            kind, value = next(iter(item.items()))
            if kind == 'tensor':
                return handle.get_tensor(value)
            if kind == 'nested':
                return NestedTensor([unpack(v, depth + 1) for v in value])
            if kind == 'dict':
                return {k: unpack(v, depth + 1) for k, v in value.items()}
            if kind in ('list', 'tuple'):
                values = [unpack(v, depth + 1) for v in value]
                return tuple(values) if kind == 'tuple' else values
            if kind == 'value' and (value is None or isinstance(value, (str, int, float, bool))):
                return value
            raise ValueError('Invalid H3 checkpoint type.')
        return unpack(json.loads(metadata['tree']))


class SavePreparation:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'positive': ('CONDITIONING',), 'latent': ('LATENT',)}}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = 'save'
    CATEGORY = 'Signal/H3'
    def save(self, positive, latent):
        save_stage('preparation', {'positive': positive, 'latent': latent})
        return {'ui': {'signal_stage': ['preparation saved']}}


class LoadPreparation:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {}}
    RETURN_TYPES = ('CONDITIONING', 'LATENT')
    FUNCTION = 'load'
    CATEGORY = 'Signal/H3'
    def load(self):
        value = load_stage('preparation')
        return value['positive'], value['latent']


class SaveSamples:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'latent': ('LATENT',)}}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = 'save'
    CATEGORY = 'Signal/H3'
    def save(self, latent):
        save_stage('samples', latent)
        return {'ui': {'signal_stage': ['samples saved']}}


class LoadSamples:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {}}
    RETURN_TYPES = ('LATENT',)
    FUNCTION = 'load'
    CATEGORY = 'Signal/H3'
    def load(self):
        return (load_stage('samples'),)


def load_disk_model(path):
    import importlib
    import comfy_aimdo.control
    import comfy_aimdo.model_mmap
    import comfy.memory_management
    import comfy.sd
    import comfy.utils
    # The CPU read-only mapping avoids Windows reserving a writable copy of the
    # entire checkpoint. GPU dynamic allocation stays disabled and capped.
    if comfy.memory_management.aimdo_enabled:
        raise RuntimeError('This capped loader requires GPU dynamic allocation to remain disabled.')
    # Load the native library for its CPU file mapping only. Do not initialize
    # AIMDO devices or turn on its GPU allocator, which would bypass Torch's cap.
    if not comfy_aimdo.control.init():
        raise RuntimeError('The read-only model mapping library is unavailable.')
    if comfy_aimdo.model_mmap.lib is None:
        importlib.reload(comfy_aimdo.model_mmap)
    weights, metadata = comfy.utils.load_safetensors(path)
    model = comfy.sd.load_diffusion_model_state_dict(weights, metadata=metadata, disable_dynamic=True)
    if model is None:
        raise RuntimeError('The installed H3 checkpoint was not recognized.')
    model.cached_patcher_init = (load_disk_model, (path,))
    return model


class DiskModelLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'unet_name': (['minimax_h3_ref2va_pruned_w4a8_mixed.safetensors'],)}}
    RETURN_TYPES = ('MODEL',)
    FUNCTION = 'load'
    CATEGORY = 'Signal/H3'
    def load(self, unet_name):
        import folder_paths
        return (load_disk_model(folder_paths.get_full_path_or_raise('diffusion_models', unet_name)),)


NODE_CLASS_MAPPINGS = {'SignalH3SavePreparation': SavePreparation, 'SignalH3LoadPreparation': LoadPreparation,
                       'SignalH3SaveSamples': SaveSamples, 'SignalH3LoadSamples': LoadSamples, 'SignalH3DiskModelLoader': DiskModelLoader}
