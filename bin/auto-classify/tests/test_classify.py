"""Pytest smoke test for bin/auto-classify/classify.py.

Builds a tiny synthesized WAV file, runs classify.py against it as a
subprocess, parses the stdout JSON, and asserts the expected shape.
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SIDECAR_DIR = HERE.parent
CLASSIFY_PY = SIDECAR_DIR / "classify.py"
VENV_PYTHON = SIDECAR_DIR / ".venv" / "bin" / "python"
YAMNET = SIDECAR_DIR / "yamnet.tflite"


def _python_bin() -> str:
    if VENV_PYTHON.exists():
        return str(VENV_PYTHON)
    return sys.executable


def _build_sine_wav(path: Path, freq_hz: float = 440.0, duration_sec: float = 6.0,
                    sample_rate: int = 16000) -> None:
    import math

    num_samples = int(duration_sec * sample_rate)
    pcm = bytearray()
    for i in range(num_samples):
        sample = int(math.sin(2 * math.pi * freq_hz * i / sample_rate) * 30000)
        pcm += struct.pack("<h", sample)

    data_chunk = bytes(pcm)
    header = b"RIFF"
    header += struct.pack("<I", 36 + len(data_chunk))
    header += b"WAVE"
    header += b"fmt "
    header += struct.pack("<I", 16)         # PCM fmt chunk size
    header += struct.pack("<H", 1)          # PCM
    header += struct.pack("<H", 1)          # mono
    header += struct.pack("<I", sample_rate)
    header += struct.pack("<I", sample_rate * 2)
    header += struct.pack("<H", 2)          # block align
    header += struct.pack("<H", 16)         # bits/sample
    header += b"data"
    header += struct.pack("<I", len(data_chunk))
    path.write_bytes(header + data_chunk)


@pytest.mark.skipif(not YAMNET.exists(), reason="yamnet.tflite missing — run setup.sh first")
def test_classify_smoke(tmp_path: Path) -> None:
    wav = tmp_path / "sine.wav"
    _build_sine_wav(wav, freq_hz=440.0, duration_sec=6.0, sample_rate=16000)

    result = subprocess.run(
        [_python_bin(), str(CLASSIFY_PY), str(wav)],
        cwd=str(SIDECAR_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"classify.py exited {result.returncode}\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )

    payload = json.loads(result.stdout)
    assert set(payload.keys()) >= {"segments", "audio_hash", "duration_ms"}
    assert isinstance(payload["segments"], list)
    assert len(payload["audio_hash"]) == 64  # sha256 hex
    assert payload["duration_ms"] > 0

    valid_types = {"music", "chatter", "tuning", "silence", "count_in", "unknown"}
    for seg in payload["segments"]:
        assert seg["segment_type"] in valid_types
        assert seg["start_ms"] >= 0
        assert seg["end_ms"] > seg["start_ms"]
        assert isinstance(seg["top_classes"], list)
        for tc in seg["top_classes"]:
            assert "name" in tc and "score" in tc
        if seg["segment_type"] == "music":
            assert "chroma" in seg
            assert isinstance(seg["chroma"], list)
            for row in seg["chroma"]:
                assert len(row) == 12
