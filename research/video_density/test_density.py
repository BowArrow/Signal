import unittest
import torch
from losses import relation_loss
from model import TinyVideoFlow, synthetic_batch, proxy_teacher


class DensityTests(unittest.TestCase):
    def test_relations_are_basis_and_positive_scale_invariant(self):
        torch.manual_seed(31)
        features = torch.randn(2, 4, 8, 6)
        rotation, _ = torch.linalg.qr(torch.randn(6, 6))
        self.assertLess(relation_loss(features, features @ rotation * 3).item(), 1e-10)

    def test_correspondence_matters_and_teacher_has_no_gradients(self):
        torch.manual_seed(32)
        student = torch.randn(2, 4, 8, 6, requires_grad=True)
        teacher = torch.randn(2, 4, 8, 3, requires_grad=True)
        loss = relation_loss(student, teacher)
        loss.backward()
        self.assertIsNone(teacher.grad)
        self.assertTrue(torch.isfinite(student.grad).all())
        self.assertGreater(student.grad.abs().sum().item(), 0)
        self.assertGreater(relation_loss(student, student.flip(1)).item(), 0.01)

    def test_collapsed_student_does_not_match_noncollapsed_teacher(self):
        torch.manual_seed(33)
        self.assertGreater(relation_loss(torch.ones(1, 3, 8, 4), torch.randn(1, 3, 8, 6)).item(), 0.1)

    def test_invalid_shapes_and_nan_rejected(self):
        features = torch.randn(1, 3, 8, 4)
        with self.assertRaises(ValueError):
            relation_loss(features, torch.randn(1, 2, 8, 4))
        with self.assertRaises(ValueError):
            relation_loss(features * float('nan'), features)

    def test_counterfactual_preserves_first_frame_and_changes_future(self):
        forward, motion = synthetic_batch(123)
        reverse, reversed_motion = synthetic_batch(123, reverse=True)
        self.assertTrue(torch.equal(forward[:, :, :1], reverse[:, :, :1]))
        self.assertTrue(torch.equal(motion, -reversed_motion))
        self.assertFalse(torch.equal(forward[:, :, 1:], reverse[:, :, 1:]))
        self.assertTrue(torch.equal(forward, synthetic_batch(123)[0]))
        self.assertFalse(torch.equal(forward, synthetic_batch(1000001)[0]))

    def test_real_backward_pass_with_different_teacher_width(self):
        torch.set_num_threads(2)
        clean, motion = synthetic_batch(34, 2)
        model = TinyVideoFlow()
        velocity, features = model(clean, torch.full((2,), 0.5), clean[:, :, :1], motion)
        self.assertEqual(velocity.shape, clean.shape)
        loss = velocity.square().mean() + relation_loss(features, proxy_teacher(clean))
        loss.backward()
        self.assertTrue(all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters()))


if __name__ == '__main__':
    unittest.main()
