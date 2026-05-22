export type Project = {
  id: string;
  title: string;
  folder: string;
  stems: ProjectStem[];
  stemCount: number;
  folderId: string | null;
  referenceStemId: string | null;
  // Precomputed waveform peaks (wire string) for the reference stem, so the
  // picker thumbnail renders without downloading and decoding the full audio.
  // null when the reference stem predates peak storage or decode failed.
  referenceStemPeaks: string | null;
  updatedAt: number;
  // Project length, in ms — max(stem.duration_ms). null when no stem has yet
  // been measured (rare during ingest).
  totalDurationMs: number | null;
  commentCount: number;
};

export type ProjectStem = {
  id: string;
  name: string;
  // Server-side waveform peaks (comma-separated 0..255 ints). When present,
  // WaveSurfer can render the waveform without decoding the audio.
  peaks: string | null;
  // Stem length in ms (measured at ingest). Lets the player render the
  // waveform + timeline from peaks before the audio finishes downloading.
  durationMs: number | null;
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
  reference_stem_peaks: string | null;
  total_duration_ms: number | null;
  comment_count: number;
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
  comment_count: number;
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
  // Stem length in seconds, known from server metadata before the audio is
  // decoded. Lets WaveSurfer render from `peaks` and the timeline lay itself
  // out while the audio downloads in the background; `audioBuffer.duration`
  // supersedes it once decode finishes. Null when the server has no measured
  // duration (rare — falls back to decoding the audio for the waveform).
  metaDuration: number | null;
};

export type LoopRegion = {
  start: number;
  end: number;
  enabled: boolean;
};

export type WaveformNormalization = 'per-track' | 'global';

export type PlayerLoading = {
  // Number of stems being fetched/decoded — the denominator for `loaded`.
  total: number;
  // Accumulated fractional byte-download progress across all stems: each stem
  // contributes up to 1.0 as its body streams in, so `loaded / total` is a
  // real-time download fraction that reaches 1.0 when every stem finishes.
  loaded: number;
  // Bumped each time the user tries to play before audio is ready. The UI
  // watches this to flash the loading indicator and announce that playback
  // will start automatically once decode finishes.
  nudge: number;
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
  // True when the user has turned looping on but no region exists yet.
  // The next ruler drag will create one; clicking the loop toggle again
  // (or successfully creating a region) disarms it.
  loopArmed: boolean;
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
  // Stem length in ms from server metadata. Drives the waveform/timeline
  // layout while the audio decodes in the background.
  durationMs?: number | null;
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
