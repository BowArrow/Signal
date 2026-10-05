import importlib.util
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, sys.argv[1])
import torch
from comfy.nested_tensor import NestedTensor

spec = importlib.util.spec_from_file_location('signal_stages', Path(__file__).resolve().parents[1] / 'src/core/video/stage_nodes/__init__.py')
stages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stages)
with tempfile.TemporaryDirectory(prefix='signal-h3-checkpoint-') as directory:
    os.environ['SIGNAL_H3_STAGE_DIR'] = directory
    tensor = torch.arange(12, dtype=torch.float16).reshape(1, 3, 4)
    value = {'positive': [[tensor, {'modality_tags': torch.tensor([0, 1, 1]), 'minimax_refs': [{'kind': 'image', 'latent': tensor}]}]],
             'latent': {'samples': NestedTensor([tensor, tensor.clone()]), 'noise_mask': None}, 'tuple': (1, True, 'fixture')}
    stages.save_stage('preparation', value)
    restored = stages.load_stage('preparation')
    assert isinstance(restored['latent']['samples'], NestedTensor)
    assert torch.equal(restored['positive'][0][0], tensor)
    assert restored['positive'][0][0].dtype == torch.float16
    assert torch.equal(restored['latent']['samples'].tensors[1], tensor)
    assert restored['tuple'] == (1, True, 'fixture')
    checkpoint = Path(directory) / 'preparation.safetensors'
    with checkpoint.open('r+b') as handle:
        handle.seek(-1, 2); handle.write(b'\xff')
    try:
        stages.load_stage('preparation')
        raise AssertionError('Corrupted checkpoint accepted')
    except ValueError as error:
        assert 'integrity' in str(error)
print('H3 tensor checkpoint roundtrip and corruption checks passed.', flush=True)
