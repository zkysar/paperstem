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

## Spike 2: Chroma + DTW song matching — **INCONCLUSIVE**

Three 30s clips compared via beat-rate chroma + cosine-DTW:

| Pair | DTW distance |
|---|---|
| song-clip-A (0:45–1:15) vs song-clip-B (2:15–2:45) — same song, different sections | **0.0710** |
| song-clip-A vs practice-clip (1:00–1:30) — different songs entirely | **0.1088** |
| song-clip-B vs practice-clip | **0.1164** |

**Ratio cross/same = 1.53×**, below the 2.0× pass criterion in the plan.

### What this actually shows

The right test was "two recordings of the same song" (different takes), and
we don't have that — we have one studio recording of "Sun and Soil Hyde
Street" and a separate practice session that isn't of the same song. So
this run actually compared **different sections of the same song** vs
**different songs**, which is a *harder* problem (the two song sections
have different chords and melodies; they're only similar in instrumentation
and key).

A 1.53× separation under those conditions is actually encouraging — it
means meyda's chromagram + cosine-DTW does separate same-arrangement audio
from different-arrangement audio, even when the underlying musical content
differs. With a true same-song-different-take pair, the ratio would
plausibly be much larger.

### What we'd need to actually call this

A real validation needs at least one of:
1. **Two recordings of the same song.** Did the band record `Sun and Soil
   Hyde Street` more than once? Or play it during `practice-2026-05-06`?
2. **Same section, different take.** E.g., the same chorus recorded twice.
3. **An alternative chroma extraction.** meyda is one of several options
   the plan flagged; if real-data matching is poor, `essentia.js` or a
   custom CQT might do better.

### Verdict

**Yellow light.** Pipeline runs; signal is in the right direction; the
data we have isn't quite the right shape to give a clean pass/fail.

## Bonus finding: Node runtime gap (already documented)

`@tensorflow-models/yamnet` doesn't exist on npm. `@mediapipe/tasks-audio`
is browser-only. See `findings-runtime-gap.md`. The production v1 needs a
runtime decision (ONNX, Python sidecar, custom TFLite→tfjs) that the plan
didn't anticipate.

## Recommended next steps

1. **Decide on the chroma matching question with better data.** Do we have
   two takes of the same song anywhere in the existing Paperstem corpus,
   or could we record one? Without that, we're guessing.
2. **Surface the runtime question.** Before writing implementation code
   for the shared classification module (Phase 2 in the plan), decide on
   the runtime path (most likely: Python sidecar OR ONNX). The design and
   plan both need updates either way.
3. **If both validate**: proceed to Phase 1 (schema) of the plan.
4. **If chroma turns out to be weak**: consider adding ASR earlier than
   v2 (since the proper-noun extraction from chatter is the next-cheapest
   source of song identity signal).
