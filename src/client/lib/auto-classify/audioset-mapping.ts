// AudioSet (YAMNet) display name → Paperstem coarse SegmentType.
//
// Kept in sync by hand with bin/auto-classify/audioset_mapping.py.
// If you change the rules here, mirror them there.
import type { SegmentType, TopClass } from '../../../shared/types';

const MIN_CONFIDENCE = 0.1;

// Coarse class → AudioSet display names that map to it. Curated set; extend
// as real-audio runs reveal which AudioSet classes actually fire on band
// practice audio. See scripts/poc/findings-phase-0.md for the validation that
// these rules separate music ↔ chatter on a real practice clip.
const RULES: Array<{ paperstem: SegmentType; audiosetNames: string[] }> = [
  { paperstem: 'silence', audiosetNames: ['Silence'] },
  { paperstem: 'tuning', audiosetNames: ['Tuning fork', 'Tuning instrument'] },
  {
    paperstem: 'chatter',
    audiosetNames: [
      'Speech',
      'Conversation',
      'Whispering',
      'Narration, monologue',
      'Male speech, man speaking',
      'Female speech, woman speaking',
    ],
  },
  {
    paperstem: 'music',
    audiosetNames: [
      'Music',
      'Singing',
      'Drum kit',
      'Drum',
      'Snare drum',
      'Bass drum',
      'Guitar',
      'Electric guitar',
      'Acoustic guitar',
      'Bass guitar',
      'Piano',
      'Keyboard (musical)',
      'Strum',
      'Plucked string instrument',
    ],
  },
];

function classFor(name: string): SegmentType | null {
  for (const rule of RULES) {
    if (rule.audiosetNames.includes(name)) return rule.paperstem;
  }
  return null;
}

/**
 * Map a single YAMNet window's top-K class list to a coarse Paperstem
 * SegmentType. Uses only the top-1 prediction; below MIN_CONFIDENCE, returns
 * 'unknown'.
 */
export function mapTopClassesToSegmentType(top: TopClass[]): SegmentType {
  if (top.length === 0) return 'unknown';
  const winner = top[0];
  if (winner.score < MIN_CONFIDENCE) return 'unknown';
  return classFor(winner.name) ?? 'unknown';
}
