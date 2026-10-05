"""Independent relational-alignment prototype, not Sophontic's private method.

Features are [batch, time, spatial tokens, channels]. Spatial and temporal
relations have separate means so background token counts cannot set the mix.
No alignment projector is needed when comparing within-representation cosines.
"""
import torch
import torch.nn.functional as F


def relation_loss(student, teacher):
    if student.ndim != 4 or teacher.ndim != 4 or student.shape[:3] != teacher.shape[:3]:
        raise ValueError('Expected aligned B,T,N,C features; channel counts may differ.')
    if student.shape[1] < 2 or student.shape[2] < 2 or student.shape[2] > 64:
        raise ValueError('Use at least two frames and 2..64 pooled spatial tokens.')
    if not torch.isfinite(student).all() or not torch.isfinite(teacher).all():
        raise ValueError('Features must be finite.')
    s = F.normalize(student.float(), dim=-1, eps=1e-6)
    t = F.normalize(teacher.detach().float(), dim=-1, eps=1e-6)
    spatial_s, spatial_t = s @ s.transpose(-1, -2), t @ t.transpose(-1, -2)
    off_diagonal = ~torch.eye(s.shape[2], device=s.device, dtype=torch.bool)
    spatial = (spatial_s - spatial_t).square()[..., off_diagonal].mean()
    temporal = ((s[:, 1:] @ s[:, :-1].transpose(-1, -2)) -
                (t[:, 1:] @ t[:, :-1].transpose(-1, -2))).square().mean()
    return (spatial + temporal) / 2


def feature_spread(features):
    """Diagnostic only. Low loss with collapsing features is not success."""
    return features.detach().float().flatten(0, 2).std(dim=0).mean()
