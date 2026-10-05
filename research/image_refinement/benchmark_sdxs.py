"""Batch-one local baseline. Run under limited_runtime.py; no network or custom code."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import time


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def summary(values):
    ordered = sorted(values)
    return {'median_ms': statistics.median(values),
            'p95_ms': ordered[math.ceil(.95 * len(ordered)) - 1],
            'samples_ms': values}


def main(args):
    args.output.mkdir(parents=True, exist_ok=False)
    import torch
    from diffusers import StableDiffusionPipeline
    from PIL import Image
    torch.set_num_threads(2)
    start = time.perf_counter()
    pipe = StableDiffusionPipeline.from_pretrained(
        str(args.model), torch_dtype=torch.float16, local_files_only=True,
        use_safetensors=True, low_cpu_mem_usage=True).to('cuda')
    pipe.set_progress_bar_config(disable=True)
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - start
    prompts = [
        'Cinematic photograph of a lighthouse on a rocky coast at sunset, dramatic clouds, detailed waves, warm beacon, realistic photography',
        'Cinematic close up portrait of an adult woman in a raincoat, natural skin texture, soft window light, realistic photography',
        'Wide cinematic photograph of a medieval stone street at night, wet cobblestones, warm lanterns, detailed architecture',
    ]
    samples, images = [], []
    with torch.inference_mode():
        for i in range(2):
            pipe(prompts[0], num_inference_steps=1, guidance_scale=0.,
                 generator=torch.Generator('cuda').manual_seed(i))
        for prompt_index, prompt in enumerate(prompts):
            torch.cuda.synchronize()
            start = time.perf_counter()
            embeddings = pipe.encode_prompt(prompt, 'cuda', 1, False)[0]
            torch.cuda.synchronize()
            encode_ms = (time.perf_counter() - start) * 1000
            for seed in range(4):
                torch.cuda.reset_peak_memory_stats()
                torch.cuda.synchronize()
                start = time.perf_counter()
                result = pipe(prompt_embeds=embeddings, num_inference_steps=1,
                              guidance_scale=0., width=512, height=512,
                              generator=torch.Generator('cuda').manual_seed(seed)).images[0]
                torch.cuda.synchronize()
                elapsed = (time.perf_counter() - start) * 1000
                path = args.output / f'prompt-{prompt_index}-seed-{seed}.png'
                result.save(path)
                images.append(result)
                samples.append({'prompt': prompt, 'seed': seed, 'cached_prompt_to_pil_ms': elapsed,
                                'text_encode_ms': encode_ms, 'file': path.name,
                                'allocated_peak_bytes': torch.cuda.max_memory_allocated(),
                                'reserved_peak_bytes': torch.cuda.max_memory_reserved(),
                                'sha256': digest(path)})
                print(json.dumps(samples[-1]), flush=True)
    sheet = Image.new('RGB', (4 * 256, 3 * 256))
    for i, frame in enumerate(images):
        sheet.paste(frame.resize((256, 256)), ((i % 4) * 256, (i // 4) * 256))
    sheet.save(args.output / 'contact-sheet.jpg')
    result = {'model': 'IDKiro/sdxs-512-dreamshaper',
              'revision': '76f720262bb051da75666b22c902a78c8e16c763',
              'gpu': torch.cuda.get_device_name(), 'torch': torch.__version__,
              'load_seconds': load_seconds, 'batch_size': 1, 'steps': 1,
              'guidance_scale': 0, 'dtype': 'float16', 'resolution': [512, 512],
              'compiled': False, 'warmup_calls': 2,
              'cached_prompt_to_pil': summary([s['cached_prompt_to_pil_ms'] for s in samples]),
              'scope': 'Synchronized batch-one inference including decoder and CPU PIL conversion; excludes file I/O, text encoding and model loading.',
              'samples': samples, 'source_sha256': digest(Path(__file__)),
              'weights': {str(p.relative_to(args.model)): digest(p) for p in args.model.rglob('*.safetensors')},
              'quality_approved': False, 'video_tested': False}
    (args.output / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k not in ('samples', 'weights')}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    main(parser.parse_args())
