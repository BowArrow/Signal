"""Restricted group-action baseline: learn a motion map, reuse first-frame pixels.

Two learned scalars do not include the hard-coded image resampler's complexity.
This cannot create new objects, disoccluded surfaces, or arbitrary scene changes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import time

import torch
from torch import nn
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from experiment import save_preview
from model import synthetic_batch


class TranslationTransport(nn.Module):
    def __init__(self):
        super().__init__()
        self.coefficients = nn.Parameter(torch.randn(2) * 0.1)

    def forward(self, first, motion, frames=8):
        batch, channels, _, height, width = first.shape
        y, x = torch.meshgrid(torch.linspace(-1, 1, height, device=first.device),
                              torch.linspace(-1, 1, width, device=first.device), indexing='ij')
        grid = torch.stack((x, y), dim=-1)[None, None]
        quarter_turn = torch.stack((-motion[:, 1], motion[:, 0]), dim=-1)
        velocity = self.coefficients[0] * motion + self.coefficients[1] * quarter_turn
        t = torch.linspace(0, 1, frames, device=first.device)
        grid = grid - velocity[:, None, None, None, :] * t[None, :, None, None, None]
        first = first[:, :, 0][:, None].expand(-1, frames, -1, -1, -1)
        # Convert [-1,1] to [0,1] so padding means the known black background.
        images = F.grid_sample((first.reshape(batch * frames, channels, height, width) + 1) / 2,
                               grid.reshape(batch * frames, height, width, 2),
                               mode='bilinear', padding_mode='zeros', align_corners=True) * 2 - 1
        return images.reshape(batch, frames, channels, height, width).permute(0, 2, 1, 3, 4)


def centroid(video):
    weight = ((video + 1) / 2).clamp_min(0).sum(dim=1)
    y, x = torch.meshgrid(torch.linspace(-1, 1, video.shape[-2]),
                         torch.linspace(-1, 1, video.shape[-1]), indexing='ij')
    total = weight.sum(dim=(-1, -2)).clamp_min(1e-8)
    return torch.stack(((weight * x).sum(dim=(-1, -2)) / total,
                        (weight * y).sum(dim=(-1, -2)) / total), dim=-1)


@torch.no_grad()
def evaluate_transport(model, seed):
    clean, motion = synthetic_batch(seed, 8)
    reverse, reverse_motion = synthetic_batch(seed, 8, reverse=True)
    prediction = model(clean[:, :, :1], motion)
    counterfactual = model(clean[:, :, :1], reverse_motion)
    static = clean[:, :, :1].expand_as(clean)
    metrics = {
        'generated_future_pixel_mse': F.mse_loss(prediction[:, :, 1:], clean[:, :, 1:]).item(),
        'generated_temporal_delta_mse': F.mse_loss(prediction.diff(dim=2), clean.diff(dim=2)).item(),
        'counterfactual_delta_mse': F.mse_loss(prediction - counterfactual, clean - reverse).item(),
        'centroid_trajectory_mse': F.mse_loss(centroid(prediction), centroid(clean)).item(),
        'static_centroid_trajectory_mse': F.mse_loss(centroid(static), centroid(clean)).item(),
    }
    return metrics, clean, prediction


def run(folder):
    folder.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    config = {'torch': torch.__version__, 'device': 'cpu', 'steps': 150, 'seeds': 3,
              'learning_rate': 0.05, 'training_data': 'same procedural seeds as density pilot',
              'comparison_seed': 1000001, 'fresh_evaluation_seed': 1100003,
              'inputs': 'first frame and motion control only; no hidden scene state',
              'model_assumptions': 'rigid 2D translation, constant appearance, black boundary',
              'parameter_count_excludes': 'fixed grid sampler and provided first-frame pixels',
              'compute_matched': False, 'sophontic_replication': False}
    (folder / 'config.json').write_text(json.dumps(config, indent=2))
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')}
    (folder / 'source-hashes.json').write_text(json.dumps(hashes, indent=2))
    rows = []
    started = time.perf_counter()
    for seed in range(3):
        torch.manual_seed(seed)
        model = TranslationTransport()
        optimizer = torch.optim.Adam(model.parameters(), lr=0.05)
        for step in range(150):
            clean, motion = synthetic_batch(seed * 10000 + step)
            loss = F.mse_loss(model(clean[:, :, :1], motion)[:, :, 1:], clean[:, :, 1:])
            if not torch.isfinite(loss):
                raise ValueError('Non-finite transport loss.')
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
        comparison, target, prediction = evaluate_transport(model, 1000001)
        fresh, _, _ = evaluate_transport(model, 1100003)
        checkpoint = folder / f'transport-seed-{seed}.safetensors'
        save_file(model.state_dict(), str(checkpoint))
        restored = TranslationTransport()
        restored.load_state_dict(load_file(str(checkpoint)))
        reproduced, _, _ = evaluate_transport(restored, 1100003)
        if fresh != reproduced:
            raise ValueError('Checkpoint evaluation did not reproduce.')
        # Zero motion must preserve the input under our documented interpolation tolerance.
        with torch.no_grad():
            still = model(target[:, :, :1], torch.zeros(8, 2))
            if not torch.allclose(still, target[:, :, :1].expand_as(still), atol=2e-6):
                raise ValueError('Zero-motion identity failed.')
        row = {'seed': seed, 'parameters': sum(p.numel() for p in model.parameters()),
               'coefficients': model.coefficients.detach().tolist(), 'comparison': comparison,
               'fresh_evaluation': fresh, 'checkpoint_sha256': hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
               'checkpoint_reproduced': True, 'zero_motion_identity_passed': True}
        rows.append(row)
        if seed == 0:
            save_preview(folder, 'transport', target, prediction)
    result = {'completed': True, 'qualityApproved': False, 'seconds': time.perf_counter() - started,
              'scope': 'Restricted translation demonstration; no natural-video or high-resolution speed claim',
              'rows': rows, 'summary': {split: {key: {'mean': statistics.mean(r[split][key] for r in rows),
              'sample_std': statistics.stdev(r[split][key] for r in rows)} for key in rows[0][split]}
              for split in ('comparison', 'fresh_evaluation')}}
    (folder / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    run(parser.parse_args().output.resolve())
