"""Bounded owned-procedural image training and actual GPU timing; no cinema claim."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import time

import torch
import torch.nn.functional as F
from PIL import Image
from safetensors.torch import load_file, save_file

from compact_refiner import CompactRefiner, edge_error


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def pairs(seed, count=4, size=128):
    """Owned analytic textures/shapes. All randomness comes from this local seed."""
    generator = torch.Generator('cpu').manual_seed(seed)
    def rand(*shape):
        return torch.rand(shape, generator=generator)
    y, x = torch.meshgrid(torch.linspace(-1, 1, size), torch.linspace(-1, 1, size), indexing='ij')
    x, y = x[None, None], y[None, None]
    target = .15 + .35 * rand(count, 3, 1, 1) + .15 * (x + 1) + .1 * (y + 1)
    for _ in range(3):
        cx, cy = rand(count, 1, 1, 1) * 1.6 - .8, rand(count, 1, 1, 1) * 1.6 - .8
        radius = .1 + rand(count, 1, 1, 1) * .45
        mask = (((x - cx) ** 2 + (y - cy) ** 2) < radius ** 2).float()
        target = target * (1 - mask) + rand(count, 3, 1, 1) * mask
    target = (target + .06 * torch.sin((x * (2 + 5 * rand(count, 3, 1, 1)) +
                                      y * (2 + 5 * rand(count, 3, 1, 1))) * math.pi)).clamp(0, 1)
    draft = F.interpolate(F.interpolate(target, size=size // 2, mode='area'),
                          size=size, mode='bilinear', align_corners=False)
    noise = torch.randn(draft.shape, generator=generator) * .025
    return (draft + noise).clamp(0, 1), target


def scores(prediction, target):
    mse = (prediction.float() - target.float()).square().mean().item()
    return {'mse': mse, 'psnr_db': -10 * math.log10(max(mse, 1e-12)),
            'edge_l1': edge_error(prediction.float(), target.float()).item()}


def describe(values):
    return {'median_ms': statistics.median(values),
            'p95_ms': sorted(values)[math.ceil(.95 * len(values)) - 1], 'samples_ms': values}


def pil(tensor):
    return Image.fromarray((tensor.detach().float().clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).round().astype('uint8'))


@torch.inference_mode()
def measure(model, height, width):
    # Throughput and latency are measured batch-one, sequentially, on one GPU.
    cpu_input = torch.randint(0, 256, (height, width, 3), dtype=torch.uint8)
    device_input = cpu_input.to('cuda').permute(2, 0, 1).unsqueeze(0).to(torch.float16).div_(255).contiguous(memory_format=torch.channels_last)
    for _ in range(8):
        model(device_input)
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    gpu_times, complete_times = [], []
    for _ in range(30):
        start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
        start.record()
        output = model(device_input)
        end.record()
        end.synchronize()
        gpu_times.append(start.elapsed_time(end))
        torch.cuda.synchronize()
        begin = time.perf_counter()
        uploaded = cpu_input.to('cuda').permute(2, 0, 1).unsqueeze(0).to(torch.float16).div_(255).contiguous(memory_format=torch.channels_last)
        downloaded = model(uploaded)[0].permute(1, 2, 0).mul(255).round().to(torch.uint8).cpu()
        torch.cuda.synchronize()
        complete_times.append((time.perf_counter() - begin) * 1000)
        if downloaded.shape != (height, width, 3) or not torch.isfinite(output).all():
            raise RuntimeError('Invalid inference output')
    return {'resolution': [width, height], 'gpu_forward': describe(gpu_times),
            'cpu_u8_input_to_cpu_u8_output': describe(complete_times),
            'torch_peak_allocated_bytes': torch.cuda.max_memory_allocated(),
            'torch_peak_reserved_bytes': torch.cuda.max_memory_reserved(),
            'warmup_calls': 8, 'iterations': 30, 'batch': 1, 'compiled': False,
            'scope': 'FP16 trained student only, no renderer/text/generator/encode/display. Random input for speed, not quality evaluation.'}


def main(args):
    args.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.manual_seed(20261004)
    torch.backends.cudnn.benchmark = False
    model = CompactRefiner().to('cuda', memory_format=torch.channels_last)
    validation_input, validation_target = pairs(args.evaluation_seed, count=16)
    validation_input = validation_input.to('cuda', memory_format=torch.channels_last)
    validation_target = validation_target.to('cuda')
    with torch.inference_mode():
        if not torch.equal(model(validation_input), validation_input):
            raise RuntimeError('Zero-head identity initialization failed')
    optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.0001)
    started = time.perf_counter()
    history = []
    for step in range(args.steps):
        if time.perf_counter() - started > 240:
            raise RuntimeError('Training time budget exceeded')
        draft, target = pairs(step)
        draft, target = draft.to('cuda', memory_format=torch.channels_last), target.to('cuda')
        optimizer.zero_grad(set_to_none=True)
        output = model(draft)
        loss = (output - target).abs().mean() + .1 * edge_error(output, target)
        if not torch.isfinite(loss):
            raise RuntimeError('Nonfinite training loss')
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
        optimizer.step()
        if step % max(30, args.steps // 6) == 0 or step == args.steps - 1:
            history.append({'step': step, 'loss': loss.item()})
            print(json.dumps(history[-1]), flush=True)
    torch.cuda.synchronize()
    train_seconds = time.perf_counter() - started
    model.eval()
    checkpoint = args.output / 'student.safetensors'
    save_file({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}, str(checkpoint))
    with torch.inference_mode():
        prediction = model(validation_input)
        base_metrics = scores(validation_input, validation_target)
        blur_metrics = scores(F.avg_pool2d(F.pad(validation_input, (1, 1, 1, 1), mode='reflect'), 3, stride=1), validation_target)
        model_metrics = scores(prediction, validation_target)
        reloaded = CompactRefiner().to('cuda', memory_format=torch.channels_last)
        reloaded.load_state_dict(load_file(str(checkpoint)))
        delta = (reloaded(validation_input) - prediction).abs().max().item()
        if delta > 1e-6:
            raise RuntimeError('Checkpoint reload changed prediction')
        sheet = Image.new('RGB', (128 * 3, 128 * 6))
        for row in range(6):
            for column, batch in enumerate([validation_input, prediction, validation_target]):
                sheet.paste(pil(batch[row]), (column * 128, row * 128))
        sheet.save(args.output / 'draft-student-target.png')
        model.half()
        half_metrics = scores(model(validation_input.half()), validation_target)
    parameters = sum(p.numel() for p in model.parameters())
    del optimizer, reloaded, prediction, validation_input, validation_target, draft, target, output, loss
    torch.cuda.empty_cache()
    timing = [measure(model, 512, 512), measure(model, 720, 1280)]
    result = {'model': 'independent compact RGB residual student', 'parameters': parameters,
              'fp16_weight_bytes': parameters * 2, 'training_steps': args.steps,
              'train_seconds': train_seconds, 'history': history,
              'training_domain': 'owned analytic circles, gradients and sinusoidal textures; random half-resolution/noise degradation',
              'training_seeds': [0, args.steps - 1], 'heldout_seed': args.evaluation_seed,
              'heldout_images': 16, 'quality_resolution': [128, 128],
              'draft_metrics': base_metrics, 'student_fp32_metrics': model_metrics,
              'fixed_3x3_box_blur_metrics': blur_metrics,
              'student_fp16_metrics': half_metrics, 'reload_max_absolute_difference': delta,
              'gpu': torch.cuda.get_device_name(), 'torch': torch.__version__, 'timings': timing,
              'checkpoint_sha256': digest(checkpoint),
              'sources': {name: digest(Path(__file__).parent / name) for name in ['compact_refiner.py', 'refiner_pilot.py']},
              'cinematic_quality_approved': False, 'text_generation': False,
              'temporal_tested': False, 'sol_replication': False}
    (args.output / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k not in ('timings', 'sources', 'history')}, indent=2))
    for row in timing:
        print(json.dumps({'resolution': row['resolution'], 'gpu_median_ms': row['gpu_forward']['median_ms'],
                          'cpu_to_cpu_p95_ms': row['cpu_u8_input_to_cpu_u8_output']['p95_ms']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--steps', type=int, default=180)
    parser.add_argument('--evaluation-seed', type=int, default=1000001)
    args = parser.parse_args()
    if not 1 <= args.steps <= 2000 or args.evaluation_seed < 1000000:
        parser.error('Use 1-2000 steps and a held-out seed >=1000000')
    main(args)
