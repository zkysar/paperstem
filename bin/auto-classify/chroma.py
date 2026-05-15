"""Chroma feature extraction for the auto-classify Python sidecar.

Uses librosa's `chroma_stft` over a mono Float32 numpy array. Output shape
matches the browser-side `extractChromaSequence` (frame-rate sequence of
12-D vectors with index 0 = C, …, 9 = A, …, 11 = B).

Note: librosa's chroma_stft is frame-rate, not beat-synchronous — matching
the browser's frame-rate choice in src/client/lib/auto-classify/chroma.ts.
DTW handles tempo differences across renditions.
"""
from __future__ import annotations

import numpy as np
import librosa

# Mirror the browser-side constants from chroma.ts so produced fingerprints
# are comparable across the two implementations.
CHROMA_FRAME_SIZE = 4096  # ~186ms at 22.05kHz
CHROMA_HOP_SIZE = 2048    # ~93ms hop
CHROMA_SAMPLE_RATE = 22050


def extract_chroma_sequence(audio: np.ndarray, sample_rate: int = CHROMA_SAMPLE_RATE) -> list[list[float]]:
    """Compute a frame-rate chroma sequence over a mono Float32 audio buffer.

    Returns a list of 12-D Python lists so it can be JSON-encoded directly.
    """
    if audio.ndim != 1:
        raise ValueError(f"extract_chroma_sequence: expected mono audio, got shape {audio.shape}")
    if audio.size < CHROMA_FRAME_SIZE:
        return []
    # librosa returns shape (12, n_frames). We transpose so each row is a
    # single frame's 12-D vector.
    chroma = librosa.feature.chroma_stft(
        y=audio.astype(np.float32, copy=False),
        sr=sample_rate,
        n_fft=CHROMA_FRAME_SIZE,
        hop_length=CHROMA_HOP_SIZE,
        center=False,
    )
    return chroma.T.astype(float).tolist()
