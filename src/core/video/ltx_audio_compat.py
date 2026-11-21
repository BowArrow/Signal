"""Match float32 mel preprocessing to the owned BF16 audio encoder.

Keep STFT/mel operations in float32 and cast only at the neural encoder boundary.
Applied in memory by the managed bootstrap; installed ComfyUI files stay intact.
"""
import functools


def install_audio_encoder_dtype(autoencoder_class):
    original = autoencoder_class.encode
    if getattr(original, '_signal_input_dtype', False):
        return

    @functools.wraps(original)
    def encode(self, mel, *args, **kwargs):
        parameter = next(self.encoder.parameters())
        return original(self, mel.to(dtype=parameter.dtype), *args, **kwargs)

    encode._signal_input_dtype = True
    autoencoder_class.encode = encode
