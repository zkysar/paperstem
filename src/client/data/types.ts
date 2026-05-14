export type Project = {
  id: string;
  title: string;
  folder: string;
  stems: ProjectStem[];
  stemCount: number;
  folderId: string | null;
  referenceStemId: string | null;
};

export type ProjectStem = {
  id: string;
  name: string;
  // Server-side waveform peaks (comma-separated 0..255 ints). When present,
  // WaveSurfer can render the waveform without decoding the audio.
  peaks: string | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  recorded_on: string | null;
  folder_id: string | null;
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
  peaks: string | null;
};

export type ProjectDetail = {
  id: string;
  band_id: string;
  name: string;
  recorded_on: string | null;
  folder_id: string;
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
  // Decoded Web Audio buffer used for sample-accurate scheduled playback.
  // Null only when decode failed; the stem is then playback-disabled but still
  // appears in the UI for waveform display and rename/delete.
  audioBuffer: AudioBuffer | null;
  userMuted: boolean;
  soloed: boolean;
  userVolume: number;
  projectId: string | null;
  // Stem id from the API. Null for local-folder loads (the user picked a folder
  // from disk; nothing to rename/delete server-side).
  serverId: string | null;
  revoke?: () => void;
  // Per-track gain node in the Web Audio graph: BufferSource → gain → master →
  // output. Null only if Web Audio failed at load time.
  gain: GainNode | null;
  // Pre-computed waveform peaks (0..1 floats). When present, WaveSurfer renders
  // without decoding the audio — eliminates the multi-second blank-lane gap.
  peaks: number[] | null;
};

export type LoopRegion = {
  start: number;
  end: number;
  enabled: boolean;
};

export type WaveformNormalization = 'per-track' | 'global';

export type PlayerLoading = {
  // Display names (after common-prefix strip) and palette colors so the player
  // can render skeleton tracks with the right shape while audio metadata is
  // still being fetched. `loaded` increments as each stem's `loadedmetadata`
  // (or error) resolves.
  displayNames: string[];
  colors: string[];
  loaded: number;
};

export type PlayerState = {
  projectId: string | null;
  title: string;
  folderId: string | null;
  stems: LoadedStem[];
  duration: number;
  referenceIdx: number;
  isPlaying: boolean;
  loop: LoopRegion | null;
  status: string;
  loading: PlayerLoading | null;
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
  peaks?: number[] | null;
};

export type LoadContext = {
  projectId: string | null;
  title: string;
};

export type TrashProject = {
  id: string;
  name: string;
  deleted_at: number;
  deleted_by_email: string | null;
  deleted_reason: 'user' | 'drive_missing';
};

export type TrashStem = {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  deleted_at: number;
  deleted_by_email: string | null;
  deleted_reason: 'user' | 'drive_missing';
};

export type TrashList = {
  projects: TrashProject[];
  stems: TrashStem[];
};
