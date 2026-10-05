"""Avoid temporary full-precision LTX upscaler weights in the dynamic loader."""
import torch


def install_meta_upscaler(upsampler):
    """Upstream's dynamic loader assigns every checkpoint tensor after creation.

    Construct shapes on meta so it does not allocate FP32 weights and then a
    second BF16 copy. Fail closed if upstream stops using strict assignment.
    This adapter is scoped to LTX's upscaler class in Signal's worker process.
    """
    original_factory = upsampler.from_config.__func__
    original_load = upsampler.load_state_dict

    @classmethod
    def from_config(cls, config, operations):
        with torch.device('meta'):
            return original_factory(cls, config, operations)

    def load_state_dict(self, state_dict, strict=True, assign=False):
        if not strict or not assign:
            raise RuntimeError('Signal LTX upscaler requires strict dynamic weight assignment.')
        result = original_load(self, state_dict, strict=True, assign=True)
        if any(t.is_meta for t in [*self.parameters(), *self.buffers()]):
            raise RuntimeError('Signal LTX upscaler has unmaterialized checkpoint tensors.')
        return result

    upsampler.from_config = from_config
    upsampler.load_state_dict = load_state_dict
