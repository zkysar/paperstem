import type { SegmentType } from '../../shared/types.js';

/**
 * Confidence thresholds for the rule-based namer.
 *
 * Calibrated against Phase 0 POC findings (scripts/poc/findings-phase-0.md):
 *  - DTW distance ≤ 0.07 → confident match (≥ CONFIDENCE_HIGH)
 *  - 0.07 < distance ≤ 0.11 → tentative match (≥ CONFIDENCE_LOW)
 *  - distance > 0.11 → no match (< CONFIDENCE_LOW)
 *
 * The matcher's distanceToConfidence() logistic curve is tuned so that
 * d=0.07 maps just above 0.7 and d=0.11 maps just above 0.4.
 */
export const CONFIDENCE_HIGH = 0.7;
export const CONFIDENCE_LOW = 0.4;

export type NamingInput = {
  segment_type: SegmentType;
  match: { song_id: string; song_name: string } | null;
  confidence: number;
};

export type NamingOutput = {
  song_id: string | null;
  song_name: string | null;
  label: string | null;
  tentative: boolean;
};

export function proposeSectionName(input: NamingInput): NamingOutput {
  const { segment_type, match, confidence } = input;
  if (segment_type === 'music') {
    if (match && confidence >= CONFIDENCE_HIGH) {
      return { song_id: match.song_id, song_name: match.song_name, label: null, tentative: false };
    }
    if (match && confidence >= CONFIDENCE_LOW) {
      return { song_id: match.song_id, song_name: match.song_name, label: null, tentative: true };
    }
    return { song_id: null, song_name: null, label: 'Music', tentative: false };
  }
  const labelByType: Partial<Record<SegmentType, string>> = {
    chatter: 'Chatter',
    tuning: 'Tuning',
    count_in: 'Count-in',
  };
  return {
    song_id: null,
    song_name: null,
    label: labelByType[segment_type] ?? null,
    tentative: false,
  };
}

export function shouldEmitSection(segment_type: SegmentType): boolean {
  return segment_type !== 'silence' && segment_type !== 'unknown';
}
