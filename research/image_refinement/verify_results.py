"""Verify the retained generation artifacts and independently reload the student."""
import argparse
import json
from pathlib import Path

import torch
from safetensors.torch import load_file

from compact_refiner import CompactRefiner
from refiner_pilot import digest, pairs, scores


def main(args):
    torch.set_num_threads(2)
    student = json.loads((args.student / 'result.json').read_text())
    baseline = json.loads((args.baseline / 'result.json').read_text())
    source = Path(__file__).parent
    for name, expected in student['sources'].items():
        if digest(source / name) != expected:
            raise RuntimeError(f'Student source changed: {name}')
    if digest(source / 'benchmark_sdxs.py') != baseline['source_sha256']:
        raise RuntimeError('Generator benchmark source changed')
    if digest(args.student / 'student.safetensors') != student['checkpoint_sha256']:
        raise RuntimeError('Student checkpoint changed')
    for sample in baseline['samples']:
        if digest(args.baseline / sample['file']) != sample['sha256']:
            raise RuntimeError('Generated image changed')
    for name, expected in baseline['weights'].items():
        if digest(args.model / name) != expected:
            raise RuntimeError(f'Generator weights changed: {name}')
    model = CompactRefiner().to('cuda', memory_format=torch.channels_last).eval()
    model.load_state_dict(load_file(str(args.student / 'student.safetensors')))
    draft, target = pairs(student['heldout_seed'], count=student['heldout_images'])
    with torch.inference_mode():
        metrics = scores(model(draft.to('cuda', memory_format=torch.channels_last)), target.to('cuda'))
    differences = {key: abs(value - student['student_fp32_metrics'][key]) for key, value in metrics.items()}
    if max(differences.values()) > 1e-5:
        raise RuntimeError(f'Reloaded metrics changed: {differences}')
    result = {'passed': True, 'image_hashes_verified': len(baseline['samples']),
              'generator_weights_verified': len(baseline['weights']),
              'student_checkpoint_and_source_verified': True,
              'student_metric_absolute_differences': differences,
              'quality_approved': False}
    if args.output.exists():
        raise ValueError('Use a fresh output receipt path')
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--student', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    main(parser.parse_args())
