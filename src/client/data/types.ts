export type Practice = {
  id: string;
  title: string;
  folder: string;
  stems: PracticeStem[];
  stemCount: number;
  driveFolderId: string | null;
  referenceStemId: string | null;
};

export type PracticeStem = {
  id: string;
  name: string;
};

export type PracticeSummary = {
  id: string;
  name: string;
  recorded_on: string | null;
  drive_folder_id: string | null;
  created_at: number;
  updated_at: number;
  stem_count: number;
  reference_stem_id: string | null;
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
  // Stem id from the API. Null for local-folder loads (the user picked a folder
  // from disk; nothing to rename/delete server-side).
  serverId: string | null;
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
  driveFolderId: string | null;
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
  // Server-side stem id, if this source came from the API. Null for
  // local-folder loads (no server stem to rename/delete).
  serverId?: string | null;
  revoke?: () => void;
};

export type LoadContext = {
  practiceId: string | null;
  title: string;
};

export type TrashPractice = {
  id: string;
  name: string;
  deleted_at: number;
  deleted_by_email: string | null;
  deleted_reason: 'user' | 'drive_missing';
};

export type TrashStem = {
  id: string;
  name: string;
  practice_id: string;
  practice_name: string;
  deleted_at: number;
  deleted_by_email: string | null;
  deleted_reason: 'user' | 'drive_missing';
};

export type TrashList = {
  practices: TrashPractice[];
  stems: TrashStem[];
};
