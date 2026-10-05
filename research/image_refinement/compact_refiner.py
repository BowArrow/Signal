"""Independent deterministic RGB residual student, not NVIDIA's architecture/weights."""
import torch
from torch import nn


class ResidualBlock(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(width, width * 2, 1), nn.SiLU(),
            nn.Conv2d(width * 2, width * 2, 3, padding=1, groups=width * 2), nn.SiLU(),
            nn.Conv2d(width * 2, width, 1))

    def forward(self, x):
        return x + .1 * self.layers(x)


class CompactRefiner(nn.Module):
    """Batch RGB [0,1], H/W multiples of four; outputs same-size corrected RGB.

    Pixel unshuffle is lossless rearrangement, not a learned generative encoder.
    Most computation occurs at H/4 x W/4. Zero initialization is exactly identity.
    This first image experiment has no text, geometry input or temporal state.
    """
    def __init__(self, width=48, blocks=6):
        super().__init__()
        self.pack = nn.PixelUnshuffle(4)
        self.stem = nn.Conv2d(48, width, 3, padding=1)
        self.body = nn.Sequential(*(ResidualBlock(width) for _ in range(blocks)))
        self.head = nn.Conv2d(width, 48, 3, padding=1)
        self.unpack = nn.PixelShuffle(4)
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    def forward(self, image):
        if image.ndim != 4 or image.shape[1] != 3 or min(image.shape[-2:]) < 16 or any(d % 4 for d in image.shape[-2:]):
            raise ValueError('Expected B,3,H,W with H/W >=16 and divisible by four.')
        features = self.body(self.stem(self.pack(image)))
        return (image + .1 * self.unpack(self.head(features))).clamp(0, 1)


def edge_error(prediction, target):
    return ((prediction[..., 1:, :] - prediction[..., :-1, :] -
             target[..., 1:, :] + target[..., :-1, :]).abs().mean() +
            (prediction[..., :, 1:] - prediction[..., :, :-1] -
             target[..., :, 1:] + target[..., :, :-1]).abs().mean()) / 2
