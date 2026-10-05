"""Bounded three-arm pilot. Invoke through Signal's Windows memory supervisor."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import time

import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw
from safetensors.torch import save_file
from losses import relation_loss, feature_spread
from model import TinyVideoFlow, synthetic_batch, proxy_teacher


def generator(seed, device):
    return torch.Generator(device=device).manual_seed(seed)


def flow_batch(clean, seed, device):
    rng = generator(seed, device)
    noise = torch.randn(clean.shape, generator=rng, device=device)
    time_value = torch.rand(clean.shape[0], generator=rng, device=device) * 0.9 + 0.05
    t = time_value[:, None, None, None, None]
    return (1 - t) * noise + t * clean, clean - noise, time_value


@torch.no_grad()
def sample(model, first, motion, seed, steps=16):
    shape = (first.shape[0], 3, 8, 16, 16)
    x = torch.randn(shape, generator=generator(seed, first.device), device=first.device)
    for step in range(steps):
        velocity, _ = model(x, torch.full((shape[0],), step / steps, device=x.device), first, motion)
        x = x + velocity / steps
    return x.clamp(-1, 1)


@torch.no_grad()
def evaluate(model, device):
    model.eval()
    clean, motion = synthetic_batch(1000001, 8)
    reverse, reverse_motion = synthetic_batch(1000001, 8, reverse=True)
    clean, motion, reverse, reverse_motion = [v.to(device) for v in (clean, motion, reverse, reverse_motion)]
    noisy, target, t = flow_batch(clean, 2000001, device)
    prediction, features = model(noisy, t, clean[:, :, :1], motion)
    generated = sample(model, clean[:, :, :1], motion, 3000001)
    counterfactual = sample(model, clean[:, :, :1], reverse_motion, 3000001)
    metrics = {
        'heldout_velocity_mse': F.mse_loss(prediction, target).item(),
        'generated_future_pixel_mse': F.mse_loss(generated[:, :, 1:], clean[:, :, 1:]).item(),
        'generated_temporal_delta_mse': F.mse_loss(generated.diff(dim=2), clean.diff(dim=2)).item(),
        'counterfactual_delta_mse': F.mse_loss(generated - counterfactual, clean - reverse).item(),
        'feature_spread': feature_spread(features).item(),
    }
    return metrics, clean.cpu(), generated.cpu()


def save_preview(folder, name, target, prediction):
    frames = []
    for index in range(8):
        canvas = Image.new('RGB', (256, 150), '#171717')
        draw = ImageDraw.Draw(canvas)
        draw.text((4, 2), 'Synthetic target', fill='white')
        draw.text((132, 2), name, fill='white')
        for x, values in [(0, target), (128, prediction)]:
            pixels = ((values[0, :, index].permute(1, 2, 0).clamp(-1, 1) + 1) * 127.5).byte().numpy()
            canvas.paste(Image.fromarray(pixels).resize((128, 128), Image.Resampling.NEAREST), (x, 22))
        frames.append(canvas)
    frames[0].save(folder / f'{name}.gif', save_all=True, append_images=frames[1:], duration=125, loop=0)
    frames[4].save(folder / f'{name}.png')


def run(args):
    folder = Path(args.output).resolve()
    folder.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    device = torch.device(args.device)
    if device.type == 'cuda':
        # The outer supervisor also limits Torch allocations to 2 GiB.
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
    config = vars(args) | {'torch': torch.__version__, 'dataset': 'owned procedural moving blobs, 8x16x16 RGB', 'teacher': 'clean pooled RGB proxy, not a foundation model', 'training_seed_range': [0, args.seeds * 10000], 'evaluation_seed': 1000001, 'steps_matched_not_compute_matched': True, 'seedance_parity_tested': False}
    (folder / 'config.json').write_text(json.dumps(config, indent=2))
    script_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')}
    (folder / 'source-hashes.json').write_text(json.dumps(script_hashes, indent=2))
    rows = []
    started_all = time.monotonic()
    for seed in range(args.seeds):
        for arm in ['baseline', 'aligned', 'shuffled']:
            torch.manual_seed(seed)
            model = TinyVideoFlow().to(device)
            optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
            init_hash = hashlib.sha256(b''.join(p.detach().cpu().numpy().tobytes() for p in model.parameters())).hexdigest()
            started = time.monotonic()
            model.train()
            for step in range(args.steps):
                clean, motion = synthetic_batch(seed * 10000 + step)
                clean, motion = clean.to(device), motion.to(device)
                noisy, target, noise_time = flow_batch(clean, 4000000 + seed * 10000 + step, device)
                prediction, features = model(noisy, noise_time, clean[:, :, :1], motion)
                loss = F.mse_loss(prediction, target)
                if arm != 'baseline':
                    teacher = proxy_teacher(clean)
                    if arm == 'shuffled':
                        # Break token correspondence while retaining feature values.
                        b, t, n, c = teacher.shape
                        permutation = torch.randperm(t * n, generator=generator(5000000 + step, device), device=device)
                        teacher = teacher.reshape(b, t * n, c)[:, permutation].reshape(b, t, n, c)
                    loss = loss + args.alignment_weight * relation_loss(features, teacher)
                if not torch.isfinite(loss):
                    raise RuntimeError('Non-finite training loss.')
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
                optimizer.step()
                if time.monotonic() - started_all > args.max_seconds:
                    raise TimeoutError('Pilot reached its wall-time budget.')
            if device.type == 'cuda':
                torch.cuda.synchronize()
            train_seconds = time.monotonic() - started
            metrics, target, prediction = evaluate(model, device)
            row = {'seed': seed, 'arm': arm, 'parameters': sum(p.numel() for p in model.parameters()), 'init_sha256': init_hash, 'train_seconds': train_seconds, **metrics}
            rows.append(row)
            checkpoint = folder / f'{arm}-seed-{seed}.safetensors'
            save_file({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}, str(checkpoint))
            row['checkpoint_sha256'] = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
            if seed == 0:
                save_preview(folder, arm, target, prediction)
            (folder / 'partial-results.json').write_text(json.dumps(rows, indent=2))
            print(json.dumps(row), flush=True)
            del model, optimizer
    summary = {arm: {metric: {'mean': statistics.mean(r[metric] for r in rows if r['arm'] == arm), 'sample_std': statistics.stdev(r[metric] for r in rows if r['arm'] == arm) if args.seeds > 1 else None} for metric in ['heldout_velocity_mse', 'generated_future_pixel_mse', 'generated_temporal_delta_mse', 'counterfactual_delta_mse', 'train_seconds']} for arm in ['baseline', 'aligned', 'shuffled']}
    result = {'completed': True, 'scope': 'Synthetic mechanism pilot only; no natural-video or Sophontic replication claim', 'qualityApproved': False, 'seconds': time.monotonic() - started_all, 'rows': rows, 'summary': summary}
    if device.type == 'cuda':
        result['torch_peak_allocated_bytes'] = torch.cuda.max_memory_allocated()
        result['torch_peak_reserved_bytes'] = torch.cuda.max_memory_reserved()
    (folder / 'result.json').write_text(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    parser.add_argument('--steps', type=int, default=150)
    parser.add_argument('--seeds', type=int, default=3)
    parser.add_argument('--alignment-weight', type=float, default=0.05)
    parser.add_argument('--max-seconds', type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.steps <= 1000 or not 1 <= args.seeds <= 5 or not 0 < args.alignment_weight <= 1 or not 1 <= args.max_seconds <= 1800:
        parser.error('Use a bounded pilot: <=1000 steps, <=5 seeds, <=1800 seconds.')
    run(args)
