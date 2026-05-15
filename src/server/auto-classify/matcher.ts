import { dtwDistance } from './dtw.js';
import { unpackChroma } from './chroma-blob.js';

export type CorpusEntry = {
  song_id: string;
  song_name: string;
  fingerprint_blob: Buffer;
  duration_ms: number;
};

export type MatchResult = {
  match: { song_id: string; song_name: string } | null;
  confidence: number;
  raw_distance: number;
};

/**
 * Calibration curve from raw DTW distance to displayed confidence.
 *
 * Tuned from Phase 0 POC findings (scripts/poc/findings-phase-0.md):
 *  - d ≤ 0.07 → confident match (≥ CONFIDENCE_HIGH = 0.7)
 *  - 0.07 < d ≤ 0.11 → tentative match (≥ CONFIDENCE_LOW = 0.4)
 *  - d > 0.11 → no match (< CONFIDENCE_LOW)
 *
 * Logistic centred at d=0.10 with steepness 30 satisfies:
 *   d=0.07 → ~0.711 (just above 0.70)
 *   d=0.11 → ~0.426 (just above 0.40)
 *   d=0.05 → ~0.818
 *   d=0.15 → ~0.182
 */
const CONFIDENCE_MIDPOINT = 0.10;
const CONFIDENCE_STEEPNESS = 30;

function distanceToConfidence(distance: number): number {
  return 1 / (1 + Math.exp(CONFIDENCE_STEEPNESS * (distance - CONFIDENCE_MIDPOINT)));
}

// Roughly the wallclock duration that one chroma frame covers, in ms.
// Matches src/client/lib/auto-classify/chroma.ts CHROMA_HOP_SIZE (2048
// samples at 22050 Hz = ~93 ms). Used only to skip corpus entries with
// dramatically different duration; not a correctness-critical constant.
const CHROMA_HOP_MS = 93;

export function matchSegmentToCorpus(
  probeChroma: number[][],
  corpus: CorpusEntry[],
  opts: { durationToleranceMs?: number } = {},
): MatchResult {
  if (corpus.length === 0 || probeChroma.length === 0) {
    return { match: null, confidence: 0, raw_distance: Infinity };
  }

  const tolerance = opts.durationToleranceMs ?? 60_000;
  const probeDurationMs = probeChroma.length * CHROMA_HOP_MS;

  let best: { entry: CorpusEntry; distance: number } | null = null;
  for (const entry of corpus) {
    if (Math.abs(entry.duration_ms - probeDurationMs) > tolerance) continue;
    const seq = unpackChroma(entry.fingerprint_blob);
    if (seq.length === 0) continue;
    const d = dtwDistance(probeChroma, seq);
    if (!best || d < best.distance) best = { entry, distance: d };
  }

  if (!best) return { match: null, confidence: 0, raw_distance: Infinity };

  return {
    match: { song_id: best.entry.song_id, song_name: best.entry.song_name },
    confidence: distanceToConfidence(best.distance),
    raw_distance: best.distance,
  };
}

export const _internal = { distanceToConfidence };
