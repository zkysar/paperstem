#!/usr/bin/env python3
"""Python sidecar: auto-classification Stage 1 for the CLI import path.

Takes an audio file path on argv, decodes to mono PCM, runs YAMNet via the
ai-edge-litert TFLite runtime, maps + smooths the per-window predictions
into segments, extracts chroma fingerprints for each music segment, and
emits a single JSON object on stdout:

    {
      "segments": [
        {
          "start_ms": int,
          "end_ms": int,
          "segment_type": "music" | "chatter" | "tuning" | "silence" | "count_in" | "unknown",
          "top_classes": [{ "name": str, "score": float }, ...],
          "chroma": [[12 floats], ...]   // only present on music segments
        },
        ...
      ],
      "audio_hash": "<sha256 hex of audio bytes>",
      "duration_ms": int
    }

The JSON shape mirrors `ClassifiedSegment[]` from src/shared/types.ts so the
CLI POST handler (Phase 3) can forward it to the server unchanged.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import resampy
import soundfile as sf
from ai_edge_litert.interpreter import Interpreter

from audioset_mapping import map_top_classes_to_segment_type
from chroma import CHROMA_SAMPLE_RATE, extract_chroma_sequence

HERE = Path(__file__).resolve().parent
YAMNET_PATH = HERE / "yamnet.tflite"
CLASS_MAP_PATH = HERE / "yamnet_class_map.csv"

YAMNET_SAMPLE_RATE = 16000
WINDOW_SAMPLES = 15600  # ~0.975s frame (the tflite's required input length)
HOP_SAMPLES = 7800      # ~0.488s hop
WINDOW_MS = int(WINDOW_SAMPLES / YAMNET_SAMPLE_RATE * 1000)
HOP_MS = int(HOP_SAMPLES / YAMNET_SAMPLE_RATE * 1000)
TOP_K = 5
MIN_SEGMENT_MS = 4000
MEDIAN_RADIUS = 2


def load_class_names() -> list[str]:
    if not CLASS_MAP_PATH.exists():
        raise FileNotFoundError(
            f"Missing {CLASS_MAP_PATH}. Run bin/auto-classify/setup.sh first."
        )
    names: list[str] = []
    with CLASS_MAP_PATH.open() as f:
        next(f)  # header
        for line in f:
            parts = line.rstrip("\n").split(",", 2)
            if len(parts) >= 3:
                names.append(parts[2].strip().strip('"'))
    return names


def decode_audio(path: str, target_rate: int) -> np.ndarray:
    data, sr = sf.read(path, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != target_rate:
        data = resampy.resample(data, sr, target_rate)
    return data.astype(np.float32)


def sha256_hex(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def classify_windows(audio: np.ndarray, names: list[str]) -> list[list[tuple[str, float]]]:
    """Run YAMNet over the audio. Returns top-K (name, score) per window."""
    interp = Interpreter(model_path=str(YAMNET_PATH))
    interp.allocate_tensors()
    input_idx = interp.get_input_details()[0]["index"]
    output_idx = interp.get_output_details()[0]["index"]

    out: list[list[tuple[str, float]]] = []
    for start in range(0, len(audio) - WINDOW_SAMPLES + 1, HOP_SAMPLES):
        frame = audio[start:start + WINDOW_SAMPLES]
        interp.set_tensor(input_idx, frame)
        interp.invoke()
        scores = interp.get_tensor(output_idx)[0]  # shape (521,)
        top_indices = np.argsort(scores)[-TOP_K:][::-1]
        top = [(names[idx], float(scores[idx])) for idx in top_indices]
        out.append(top)
    return out


def median_filter(classes: list[str], radius: int) -> list[str]:
    out: list[str] = []
    for i in range(len(classes)):
        lo = max(0, i - radius)
        hi = min(len(classes), i + radius + 1)
        counts: dict[str, int] = {}
        for c in classes[lo:hi]:
            counts[c] = counts.get(c, 0) + 1
        out.append(max(counts.items(), key=lambda kv: kv[1])[0])
    return out


def aggregate_top_classes(windows: list[list[tuple[str, float]]]) -> list[dict]:
    sums: dict[str, tuple[float, int]] = {}
    for w in windows:
        for name, score in w:
            cur_sum, cur_count = sums.get(name, (0.0, 0))
            sums[name] = (cur_sum + score, cur_count + 1)
    merged = [
        {"name": name, "score": s / c}
        for name, (s, c) in sums.items()
    ]
    merged.sort(key=lambda r: r["score"], reverse=True)
    return merged[:TOP_K]


def smooth_and_segment(
    classes: list[str],
    top_per_window: list[list[tuple[str, float]]],
    window_ms: int,
    min_segment_ms: int = MIN_SEGMENT_MS,
    median_radius: int = MEDIAN_RADIUS,
) -> list[dict]:
    """Median-smooth class predictions and merge into ClassifiedSegments.

    Mirrors src/client/lib/auto-classify/smooth.ts.
    """
    if not classes:
        return []
    smoothed = median_filter(classes, median_radius)

    # First pass: merge contiguous same-class windows.
    raw: list[dict] = []
    for i, c in enumerate(smoothed):
        if raw and raw[-1]["segment_type"] == c:
            raw[-1]["end_idx"] = i + 1
        else:
            raw.append({"start_idx": i, "end_idx": i + 1, "segment_type": c})

    # Second pass: absorb segments shorter than min_segment_ms.
    changed = True
    while changed:
        changed = False
        for i, seg in enumerate(raw):
            length_ms = (seg["end_idx"] - seg["start_idx"]) * window_ms
            if length_ms < min_segment_ms and len(raw) > 1:
                left = raw[i - 1] if i > 0 else None
                right = raw[i + 1] if i + 1 < len(raw) else None
                if left is None:
                    target = right
                elif right is None:
                    target = left
                else:
                    left_len = left["end_idx"] - left["start_idx"]
                    right_len = right["end_idx"] - right["start_idx"]
                    target = left if left_len >= right_len else right
                target["start_idx"] = min(target["start_idx"], seg["start_idx"])
                target["end_idx"] = max(target["end_idx"], seg["end_idx"])
                raw.pop(i)
                changed = True
                break
        # Re-collapse adjacent same-class segments produced by absorption.
        i = len(raw) - 1
        while i > 0:
            if raw[i]["segment_type"] == raw[i - 1]["segment_type"]:
                raw[i - 1]["end_idx"] = raw[i]["end_idx"]
                raw.pop(i)
                changed = True
            i -= 1

    out: list[dict] = []
    for r in raw:
        windows_slice = top_per_window[r["start_idx"]:r["end_idx"]]
        out.append({
            "start_ms": r["start_idx"] * window_ms,
            "end_ms": r["end_idx"] * window_ms,
            "segment_type": r["segment_type"],
            "top_classes": aggregate_top_classes(windows_slice),
        })
    return out


def run(audio_path: str) -> dict:
    if not YAMNET_PATH.exists():
        raise FileNotFoundError(
            f"Missing {YAMNET_PATH}. Run bin/auto-classify/setup.sh first."
        )
    names = load_class_names()

    audio_16k = decode_audio(audio_path, YAMNET_SAMPLE_RATE)
    top_per_window = classify_windows(audio_16k, names)
    classes = [map_top_classes_to_segment_type(t) for t in top_per_window]
    segments = smooth_and_segment(classes, top_per_window, HOP_MS)

    if any(s["segment_type"] == "music" for s in segments):
        audio_22k = decode_audio(audio_path, CHROMA_SAMPLE_RATE)
        samples_per_ms = CHROMA_SAMPLE_RATE / 1000.0
        for seg in segments:
            if seg["segment_type"] != "music":
                continue
            start_sample = int(seg["start_ms"] * samples_per_ms)
            end_sample = min(audio_22k.size, int(seg["end_ms"] * samples_per_ms))
            seg["chroma"] = extract_chroma_sequence(
                audio_22k[start_sample:end_sample], CHROMA_SAMPLE_RATE
            )

    return {
        "segments": segments,
        "audio_hash": sha256_hex(audio_path),
        "duration_ms": int(audio_16k.size / YAMNET_SAMPLE_RATE * 1000),
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: classify.py <audio-file>", file=sys.stderr)
        sys.exit(2)
    audio_path = sys.argv[1]
    if not Path(audio_path).exists():
        print(f"Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(2)
    result = run(audio_path)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
