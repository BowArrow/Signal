"""Regression for float32 mel -> BF16 audio encoder; no model download/GPU."""
import sys
import unittest
from pathlib import Path
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'src/core/video'))
from ltx_audio_compat import install_audio_encoder_dtype


class AudioEncoderDtypeTest(unittest.TestCase):
    def test_float_preprocessing_and_bfloat_encoder_can_run_together(self):
        class Encoder:
            def __init__(self):
                self.encoder = torch.nn.Linear(3, 2).to(dtype=torch.bfloat16)

            def encode(self, mel):
                return self.encoder(mel)

        encoder = Encoder()
        mel = torch.ones(1, 3, dtype=torch.float32)
        with self.assertRaises(RuntimeError):
            encoder.encode(mel)
        install_audio_encoder_dtype(Encoder)
        once = Encoder.encode
        install_audio_encoder_dtype(Encoder)
        self.assertIs(Encoder.encode, once)
        self.assertEqual(encoder.encode(mel).dtype, torch.bfloat16)
        self.assertEqual(mel.dtype, torch.float32)


if __name__ == '__main__':
    unittest.main()
