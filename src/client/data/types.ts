export type Practice = {
  id: string;
  title: string;
  folder: string;
  stems: string[];
};

export type PracticeSummary = {
  id: string;
  name: string;
  recorded_on: string | null;
  bpm: number | null;
  reference_stem: string | null;
  created_at: number;
  updated_at: number;
};

export type StemSummary = {
  id: string;
  name: string;
  position: number;
  duration_ms: number | null;
  size_bytes: number | null;
};

export type PracticeDetail = {
  id: string;
  band_id: string;
  name: string;
  recorded_on: string | null;
  drive_folder_id: string;
  bpm: number | null;
  reference_stem: string | null;
  notes: string | null;
  created_at: number;
  created_by: string;
  updated_at: number;
};

export type LoadedStem = {
  name: string;
  displayName: string;
  color: string;
  audio: HTMLAudioElement;
  userMuted: boolean;
  soloed: boolean;
  userVolume: number;
  practiceId: string | null;
  revoke?: () => void;
  // Per-track gain node in the Web Audio graph (source → gain → master → output).
  // Null if Web Audio is unavailable or wiring failed; the player falls back to
  // HTMLAudioElement.volume in that case.
  gain: GainNode | null;
};

export type LoopRegion = {
  start: number;
  end: number;
  enabled: boolean;
};

export type WaveformNormalization = 'per-track' | 'global';

export type PlayerState = {
  practiceId: string | null;
  title: string;
  stems: LoadedStem[];
  duration: number;
  referenceIdx: number;
  isPlaying: boolean;
  focusedIdx: number;
  loop: LoopRegion | null;
  status: string;
  waveformNormalization: WaveformNormalization;
  masterVolume: number;
};

export type StemSource = {
  name: string;
  src: string;
  revoke?: () => void;
};

export type LoadContext = {
  practiceId: string | null;
  title: string;
};
