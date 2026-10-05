"""Tiny conditional flow model for an owned synthetic video experiment."""
import torch
from torch import nn
import torch.nn.functional as F


class TinyVideoFlow(nn.Module):
    def __init__(self, width=24):
        super().__init__()
        self.input = nn.Conv3d(10, width, 3, padding=1)
        self.middle = nn.Sequential(nn.SiLU(), nn.Conv3d(width, width, 3, padding=1), nn.SiLU())
        self.output = nn.Conv3d(width, 3, 3, padding=1)

    def forward(self, noisy, time, first_frame, motion):
        batch, _, frames, height, width = noisy.shape
        first = first_frame.expand(-1, -1, frames, -1, -1)
        controls = motion[:, :, None, None, None].expand(-1, -1, frames, height, width)
        noise_time = time[:, None, None, None, None].expand(batch, 1, frames, height, width)
        video_time = torch.linspace(0, 1, frames, device=noisy.device)[None, None, :, None, None].expand(batch, 1, frames, height, width)
        hidden = self.middle(self.input(torch.cat([noisy, first, controls, noise_time, video_time], dim=1)))
        pooled = F.adaptive_avg_pool3d(hidden, (frames, 4, 4)).permute(0, 2, 3, 4, 1).reshape(batch, frames, 16, -1)
        return self.output(hidden), pooled


def synthetic_batch(seed, batch_size=4, reverse=False):
    """Analytic moving coloured blobs; no external videos or pretrained weights.

    Reversing motion preserves the first frame exactly. Train/eval seeds are
    disjoint; these are novel instances from one narrow procedural family.
    """
    rng = torch.Generator().manual_seed(seed)
    position = torch.rand(batch_size, 2, generator=rng) * 0.5 - 0.25
    motion = (torch.rand(batch_size, 2, generator=rng) * 0.7 - 0.35)
    if reverse:
        motion = -motion
    colours = torch.rand(batch_size, 3, generator=rng) * 0.7 + 0.3
    radius = torch.rand(batch_size, generator=rng) * 0.12 + 0.12
    grid = torch.linspace(-1, 1, 16)
    y, x = torch.meshgrid(grid, grid, indexing='ij')
    time = torch.linspace(0, 1, 8)
    centres = position[:, :, None] + motion[:, :, None] * time
    distance = (x[None, None] - centres[:, 0, :, None, None]).square() + (y[None, None] - centres[:, 1, :, None, None]).square()
    blob = torch.exp(-distance / (2 * radius[:, None, None, None].square()))
    video = colours[:, :, None, None, None] * blob[:, None]
    return video * 2 - 1, motion


def proxy_teacher(video):
    """Clean RGB patch features, NOT learned semantic/video foundation features."""
    batch, _, frames, _, _ = video.shape
    pooled = F.adaptive_avg_pool3d(video, (frames, 4, 4))
    return pooled.permute(0, 2, 3, 4, 1).reshape(batch, frames, 16, 3)
