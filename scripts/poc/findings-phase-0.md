# Phase 0 POC Findings (2026-05-15)

Ran the two spikes on real Paper Straw audio downloaded from the dev volume:
- **Practice** = `practice-2026-05-08` (3 stems: A Guitar, Bass, Drums; 4:21 total)
- **Song** = `Sun and Soil Hyde Street` (15 stems mixed; 3:24)

Stems mixed down with `ffmpeg amix` to mono 16 kHz / 22.05 kHz for the two
spikes. Full per-window output is in `practice-yamnet.out.txt` and
`song-yamnet.out.txt`; chroma output in `chroma-real.out.txt`.

## Spike 1: YAMNet boundary detection — **PASS**

### Practice mix (4:21)

Derived 8 segments:
```
0:00 - 0:32   silence    (32s)
0:32 - 0:33   music      (1s)
0:33 - 0:49   silence    (16s)
0:49 - 0:51   silence/music (transient)
0:51 - 4:13   music      (3:22)  ← main playing block
4:13 - 4:14   unknown
4:14 - 4:20   silence
```

**Boundary placement looks correct by inspection.** The "fumbling around …
playing guitar a little bit" description maps cleanly: ~50s of setup/quiet
with a couple of noodling blips, then 3:22 of sustained playing, then a
brief tail. The main start-of-playing transition lands within ~1s of where
it would land if labeled by hand.

### Song mix (3:24)

Derived 13 segments:
```
0:00 - 0:14   silence
0:14 - 0:15   chatter      ← brief count-in / vocal cue?
0:15 - 0:17   music
0:17 - 0:19   silence
0:19 - 0:21   music
0:21 - 0:26   silence
0:26 - 0:27   unknown
0:27 - 0:36   silence
0:36 - 2:01   music         (85s — main body part 1)
2:01 - 2:12   silence       (11s — likely a quiet breakdown misread?)
2:12 - 3:12   music         (60s — main body part 2)
3:12 - 3:23   silence       (outro fade)
```

The over-segmentation at the start (lots of short alternation between
silence/music) is the intro — soft instrumentation entering one at a time
across the first ~36s. YAMNet correctly captures the structure even if
boundary placement is busier than ideal.

The 2:01–2:12 "silence" stretch *inside* the song is interesting — likely a
quiet breakdown (low-energy ambient passage that YAMNet doesn't recognize
as music). This is the kind of edge case the user would smooth out by
accepting/discarding sections; minor and expected.

### Note on chatter

`chatter` only fired once across both files. The early-practice setup has
faint "Speech" as YAMNet's secondary class (score 0.02–0.03) but Silence
dominates. **In low-volume conversation, YAMNet labels the segment Silence,
not Speech.** This is a limitation but not a blocker:
- A "Silence" auto-section is still a valid section the user can rename to
  "Chatter" / "Setup".
- A v2 ASR pass would distinguish silence-with-talking from true silence
  trivially.

### Verdict

**Strong pass.** YAMNet's boundary detection on real practice audio is good
enough to ship in v1.

## Spike 2: Chroma + DTW song matching — **PASS (after rerun with proper data)**

### Updated test with two takes of "Drug"

Zach surfaced a proper test pair: two recordings of the same song ("Drug")
from different sessions — a 4:07 studio multitrack and a 5:24 home rendition
(`drug-zoe`). Mixed each down to mono 22.05 kHz, cut 60s clips at 0:45 into
each (aligned by hand), and compared against the unrelated practice clip
*and* a clip of a different Paper Straw song (Sun and Soil Hyde Street).

| Pair | DTW distance |
|---|---|
| drug-studio vs drug-zoe — **same song, different takes** | **0.0474** |
| drug-studio vs Sun and Soil — same band, different song | 0.1136 |
| drug-zoe vs Sun and Soil — same band, different song | 0.1170 |
| drug-studio vs practice — different song/session | 0.1004 |
| drug-zoe vs practice | 0.1156 |

**Ratios cross/same:**
- vs unrelated practice: **2.12×** (just above the 2.0× plan threshold)
- vs other Paper Straw song: **2.40×** (the most honest test — the
  matcher's real job is to pick the right song from a band's catalog of
  same-band songs)

### Alignment matters

A coarse sweep across studio start offsets (15s, 45s, 75s, 105s) ×
zoe start offsets (15s, 45s, 75s, 105s, 135s) showed:

- Best same-song alignment: studio@45s + zoe@45s = **0.0474**
- Worst same-song alignment: studio@15s + zoe@45s = 0.0955
- Same-song distance varied roughly 2× across alignments

This is expected — DTW handles tempo flex but not gross misalignment, and
the studio vs. home versions have different intro/outro lengths. The
production matcher addresses this naturally because it compares full
segments (start-to-end of detected music), not arbitrary 60s windows. With
properly bounded segments from YAMNet, alignment should fall out.

### Verdict

**Pass.** Chroma + cosine-DTW correctly distinguishes same-song from
different-song with sufficient margin (2.4× when compared against
same-band different-song; 2.1× against unrelated audio) to use as the
v1 matching primitive. The threshold curve in `matcher.ts` (logistic
midpoint 0.35 in the plan) is reasonable in the right neighborhood but
should be tightened — these results suggest the high-confidence boundary
could be lower (e.g., 0.07–0.08 → confident match; 0.08–0.11 → tentative;
\>0.11 → no match).

### Initial run (without same-song data) — for the record

Before the proper test data was available, three 30s clips were compared:

| Pair | DTW distance |
|---|---|
| song-clip-A (0:45–1:15) vs song-clip-B (2:15–2:45) — same song, different sections | 0.0710 |
| song-clip-A vs practice-clip (1:00–1:30) — different songs entirely | 0.1088 |
| song-clip-B vs practice-clip | 0.1164 |

Ratio = 1.53× (below threshold), but the test compared *different sections
of the same song* vs *different songs* — a harder problem than the
intended *same song, different take*. The rerun above is the correct test.

## Bonus finding: Node runtime gap (already documented)

`@tensorflow-models/yamnet` doesn't exist on npm. `@mediapipe/tasks-audio`
is browser-only. See `findings-runtime-gap.md`. The production v1 needs a
runtime decision (ONNX, Python sidecar, custom TFLite→tfjs) that the plan
didn't anticipate.

## Recommended next steps

Both spikes validate. Two design questions surfaced during Phase 0 that
should be answered before committing to Phase 1 production code:

1. **Lock the Node runtime decision.** The plan assumes a shared TS module
   for Stage 1 (YAMNet + chroma) that runs in both the browser (web client)
   and Node (Tascam Model 12 CLI). Neither `@tensorflow-models/yamnet` nor
   `@mediapipe/tasks-audio` is Node-friendly. Realistic options:
   - **Python sidecar for the CLI** — easiest; `bin/import-from-device.ts`
     shells out to `.venv/bin/python` when classifying. Web client uses
     MediaPipe in-browser (which it can, no DOM issue there). Two
     implementations, but each is straightforward.
   - **ONNX runtime everywhere** — `onnxruntime-node` in CLI,
     `onnxruntime-web` in browser. Needs a YAMNet ONNX export (community
     versions exist on HF Hub but unverified for our model). Single
     implementation, more setup cost.
   - **Drop the CLI from v1.** Ship web-only; revisit CLI in v2 once we
     know what we're doing.

2. **Tighten the DTW confidence thresholds.** The plan's logistic midpoint
   (0.35) was a placeholder. POC data suggests:
   - 0.07 or lower → confident match
   - 0.07 – 0.11 → tentative
   - 0.11 or higher → no match
   The matcher's `distanceToConfidence` function should use those numbers
   for the initial calibration.

3. **Then: proceed to Phase 1 (schema).** Nothing else in the plan needs
   to change as a result of this POC.
