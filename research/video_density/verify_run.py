"""Reload every saved pilot model and independently reproduce recorded metrics."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import torch
import torch.nn.functional as F
from safetensors.torch import load_file
from experiment import evaluate
from model import TinyVideoFlow, synthetic_batch


def verify(folder):
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    config = json.loads((folder / 'config.json').read_text())
    if config['device'] != 'cpu':
        raise ValueError('This verifier reproduces the CPU pilot only.')
    result = json.loads((folder / 'result.json').read_text())
    hashes = json.loads((folder / 'source-hashes.json').read_text())
    for name, digest in hashes.items():
        actual = hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
        if actual != digest:
            raise ValueError(f'Source changed since training: {name}')
    expected = {(seed, arm) for seed in range(config['seeds']) for arm in ('baseline', 'aligned', 'shuffled')}
    rows = result['rows']
    if len(rows) != len(expected) or {(r['seed'], r['arm']) for r in rows} != expected:
        raise ValueError('Incomplete or duplicated experiment arms.')
    for seed in range(config['seeds']):
        if len({r['init_sha256'] for r in rows if r['seed'] == seed}) != 1:
            raise ValueError('Experiment arms did not share initialization.')
    maximum_error = 0.0
    for row in rows:
        path = folder / f"{row['arm']}-seed-{row['seed']}.safetensors"
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['checkpoint_sha256']:
            raise ValueError(f'Checkpoint hash mismatch: {path.name}')
        model = TinyVideoFlow()
        model.load_state_dict(load_file(str(path)), strict=True)
        metrics, _, _ = evaluate(model, torch.device('cpu'))
        for key, actual in metrics.items():
            error = abs(actual - row[key])
            if not math.isfinite(actual) or not math.isfinite(row[key]) or error > 1e-7:
                raise ValueError(f'Metric mismatch: {path.name}: {key}')
            maximum_error = max(maximum_error, error)
    clean, _ = synthetic_batch(config['evaluation_seed'], 8)
    reverse, _ = synthetic_batch(config['evaluation_seed'], 8, reverse=True)
    static = clean[:, :, :1].expand_as(clean)
    baselines = {
        'static_first_frame_future_pixel_mse': F.mse_loss(static[:, :, 1:], clean[:, :, 1:]).item(),
        'static_first_frame_temporal_delta_mse': clean.diff(dim=2).square().mean().item(),
        'ignore_control_counterfactual_delta_mse': (clean - reverse).square().mean().item(),
    }
    report = {'verified_checkpoints': len(rows), 'maximum_metric_absolute_error': maximum_error,
              'source_hashes_match': True, 'paired_initializations_match': True,
              'trivial_baselines': baselines, 'qualityApproved': False}
    (folder / 'verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    verify(parser.parse_args().folder.resolve())
