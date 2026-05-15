#!/usr/bin/env python3
"""POC spike for YAMNet audio scene classification on Paperstem audio.

Loads yamnet.tflite (downloaded separately), decodes a target audio file to
16 kHz mono float32 via soundfile + resampy, runs inference window-by-window,
prints per-window top classes and a derived Paperstem-class segmentation,
and (if ground-truth.json is present) grades against it.

Why Python and not Node:
- @mediapipe/tasks-audio is a browser bundle; the audio runtime in Node
  was the simplest available option at the time of this spike.
- The POC's purpose is to validate the *approach*. Runtime selection for
  the production v1 (Node CLI + browser) is a separate engineering question
  that we'll address only if this spike validates.

Usage:
    .venv/bin/python spike-yamnet.py /absolute/path/to/practice.wav
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np
import resampy
import soundfile as sf

# ai-edge-litert is the slim TFLite runtime (no full tensorflow needed).
from ai_edge_litert.interpreter import Interpreter

HERE = Path(__file__).resolve().parent
YAMNET_PATH = HERE / "yamnet.tflite"
GROUND_TRUTH_PATH = HERE / "ground-truth.json"

SAMPLE_RATE = 16000          # YAMNet's required input rate
WINDOW_SAMPLES = 15600       # Exact input length the tflite expects (~0.975s)
HOP_SAMPLES = 7800           # 50% overlap (~0.488s hop)
WINDOW_MS = int(WINDOW_SAMPLES / SAMPLE_RATE * 1000)
HOP_MS = int(HOP_SAMPLES / SAMPLE_RATE * 1000)

# AudioSet class map. yamnet.tflite ships with the class index in its output
# layer; the label strings are in a CSV that the original YAMNet repo
# distributes. We fetched a copy below into the script (see CLASS_NAMES) so
# the spike is self-contained.

# --- AudioSet 521-class display names, in YAMNet's output index order. ---
# Source: https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv
# This is downloaded on first run if not cached locally next to the script
# (avoids embedding a 25KB list in the source file).
CLASS_MAP_PATH = HERE / "yamnet_class_map.csv"
CLASS_MAP_URL = "https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv"


def load_class_names() -> List[str]:
    if not CLASS_MAP_PATH.exists():
        import urllib.request
        print(f"Fetching class map from {CLASS_MAP_URL}", file=sys.stderr)
        urllib.request.urlretrieve(CLASS_MAP_URL, CLASS_MAP_PATH)
    names: List[str] = []
    with CLASS_MAP_PATH.open() as f:
        next(f)  # header: index,mid,display_name
        for line in f:
            parts = line.rstrip("\n").split(",", 2)
            if len(parts) >= 3:
                names.append(parts[2].strip().strip('"'))
    return names


PAPERSTEM_CLASS_MAP = {
    # music family
    "Music": "music", "Singing": "music", "Drum kit": "music", "Drum": "music",
    "Snare drum": "music", "Bass drum": "music", "Guitar": "music",
    "Electric guitar": "music", "Acoustic guitar": "music", "Bass guitar": "music",
    "Piano": "music", "Keyboard (musical)": "music", "Strum": "music",
    "Plucked string instrument": "music",
    # chatter family
    "Speech": "chatter", "Conversation": "chatter", "Whispering": "chatter",
    "Narration, monologue": "chatter",
    "Male speech, man speaking": "chatter",
    "Female speech, woman speaking": "chatter",
    # tuning family
    "Tuning fork": "tuning",
    # silence
    "Silence": "silence",
}


def paperstem_class(name: str) -> str:
    return PAPERSTEM_CLASS_MAP.get(name, "unknown")


def load_audio_16k(path: str) -> np.ndarray:
    data, sr = sf.read(path, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        data = resampy.resample(data, sr, SAMPLE_RATE)
    return data.astype(np.float32)


@dataclass
class Window:
    ms: int
    top: List[tuple[str, float]]
    ps_class: str


def classify(audio: np.ndarray, names: List[str]) -> List[Window]:
    interp = Interpreter(model_path=str(YAMNET_PATH))
    interp.allocate_tensors()
    input_idx = interp.get_input_details()[0]["index"]
    output_idx = interp.get_output_details()[0]["index"]

    windows: List[Window] = []
    n = 0
    for start in range(0, len(audio) - WINDOW_SAMPLES + 1, HOP_SAMPLES):
        frame = audio[start:start + WINDOW_SAMPLES]
        interp.set_tensor(input_idx, frame)
        interp.invoke()
        scores = interp.get_tensor(output_idx)[0]  # shape (521,)
        top_indices = np.argsort(scores)[-5:][::-1]
        top = [(names[idx], float(scores[idx])) for idx in top_indices]
        winner = top[0][0] if top[0][1] >= 0.1 else ""
        ps = paperstem_class(winner) if winner else "unknown"
        ms = int(start / SAMPLE_RATE * 1000)
        windows.append(Window(ms=ms, top=top, ps_class=ps))
        n += 1
        if n % 100 == 0:
            print(f"  ...{n} windows", file=sys.stderr)
    return windows


def fmt_time(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60}:{s % 60:02d}"


@dataclass
class DerivedSegment:
    start_ms: int
    end_ms: int
    type: str


def smooth_and_segment(windows: List[Window]) -> List[DerivedSegment]:
    if not windows:
        return []
    radius = 2
    smoothed: List[str] = []
    for i in range(len(windows)):
        lo = max(0, i - radius)
        hi = min(len(windows), i + radius + 1)
        counts: dict[str, int] = {}
        for j in range(lo, hi):
            t = windows[j].ps_class
            counts[t] = counts.get(t, 0) + 1
        smoothed.append(max(counts.items(), key=lambda kv: kv[1])[0])
    segs: List[DerivedSegment] = []
    for i, t in enumerate(smoothed):
        ms = windows[i].ms
        next_ms = windows[i + 1].ms if i + 1 < len(windows) else ms + HOP_MS
        if segs and segs[-1].type == t:
            segs[-1].end_ms = next_ms
        else:
            segs.append(DerivedSegment(start_ms=ms, end_ms=next_ms, type=t))
    return segs


def grade(truth: list, derived: List[DerivedSegment]) -> None:
    TOLERANCE_MS = 5000
    truth_boundaries: set[int] = set()
    for s in truth:
        truth_boundaries.add(s["start_ms"])
        truth_boundaries.add(s["end_ms"])
    derived_boundaries: set[int] = set()
    for s in derived:
        derived_boundaries.add(s.start_ms)
        derived_boundaries.add(s.end_ms)

    matched = 0
    for t in truth_boundaries:
        if any(abs(t - d) <= TOLERANCE_MS for d in derived_boundaries):
            matched += 1
    recall = matched / len(truth_boundaries) * 100 if truth_boundaries else 0
    print(f"\nBoundary recall (truth → derived, ±{TOLERANCE_MS}ms): "
          f"{matched}/{len(truth_boundaries)} = {recall:.0f}%")

    correct_ms = 0
    total_ms = 0
    for ts in truth:
        total_ms += ts["end_ms"] - ts["start_ms"]
        for ds in derived:
            if ds.type != ts["type"]:
                continue
            overlap = max(0, min(ts["end_ms"], ds.end_ms) - max(ts["start_ms"], ds.start_ms))
            correct_ms += overlap
    type_acc = correct_ms / total_ms * 100 if total_ms else 0
    print(f"Type accuracy (duration-weighted): {type_acc:.0f}%")

    print("\nPer-truth-segment summary:")
    for ts in truth:
        overlapping = []
        for ds in derived:
            ov = min(ts["end_ms"], ds.end_ms) - max(ts["start_ms"], ds.start_ms)
            if ov > 0:
                overlapping.append(f"{ds.type}({ov/1000:.1f}s)")
        print(f"  {fmt_time(ts['start_ms'])}-{fmt_time(ts['end_ms'])}  "
              f"expected={ts['type']:<8}  got: {' '.join(overlapping)}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: spike-yamnet.py <audio-file>", file=sys.stderr)
        sys.exit(1)
    audio_path = sys.argv[1]
    if not Path(audio_path).exists():
        print(f"Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(1)
    if not YAMNET_PATH.exists():
        print(f"yamnet.tflite missing at {YAMNET_PATH}", file=sys.stderr)
        sys.exit(1)

    names = load_class_names()
    print(f"Loaded {len(names)} AudioSet class names")
    print(f"Decoding {audio_path} to {SAMPLE_RATE}Hz mono float32...")
    audio = load_audio_16k(audio_path)
    print(f"Decoded {len(audio)} samples (~{len(audio)/SAMPLE_RATE:.1f}s)")

    print("Classifying...")
    windows = classify(audio, names)
    print(f"Classified {len(windows)} windows")

    # Sample of windows
    stride = max(1, len(windows) // 200)
    print(f"\nSample (every {stride}):")
    for i in range(0, len(windows), stride):
        w = windows[i]
        top_str = "  ".join(f"{n}:{s:.2f}" for n, s in w.top[:3])
        print(f"  {fmt_time(w.ms):>6}  [{w.ps_class:<8}]  {top_str}")

    segs = smooth_and_segment(windows)
    print(f"\nDerived {len(segs)} segments:")
    for s in segs:
        length = (s.end_ms - s.start_ms) / 1000
        print(f"  {fmt_time(s.start_ms):>6} - {fmt_time(s.end_ms):>6}  "
              f"{s.type:<8}  ({length:.1f}s)")

    if GROUND_TRUTH_PATH.exists():
        with GROUND_TRUTH_PATH.open() as f:
            gt = json.load(f)
        grade(gt["segments"], segs)
    else:
        print(f"\n(No {GROUND_TRUTH_PATH} found — skipping grading.)")


if __name__ == "__main__":
    main()
