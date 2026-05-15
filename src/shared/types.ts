export type User = {
  id: string;
  email: string;
  display_name: string | null;
};

export type Session = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

export type BandRole = 'owner' | 'member';

export type Band = {
  id: string;
  name: string;
  folder_id: string;
  owner_user_id: string;
  created_at: number;
};

export type BandWithRole = Band & { role: BandRole };

export type BandMember = {
  id: string;
  email: string;
  display_name: string | null;
  role: BandRole;
};

export type Reaction = {
  emoji: string;
  count: number;
  user_ids: string[];
  reacted_by_self: boolean;
};

export type AnnotationReply = {
  id: string;
  annotation_id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  body: string;
  created_at: number;
  updated_at: number;
  reactions: Reaction[];
};

export type Annotation = {
  id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  start_ms: number;
  end_ms: number | null;
  body: string;
  starred: boolean;
  created_at: number;
  updated_at: number;
  reply_count: number;
  reactions: Reaction[];
};

export type ReactionTarget =
  | { kind: 'annotation'; id: string }
  | { kind: 'reply'; id: string };

export type Song = {
  id: string;
  band_id: string;
  name: string;
  created_at: number;
  // Number of projects in which a section currently points at this song.
  // Drives the rename "Will rename in N practices" subtext and the chain
  // glyph on the section lane. Always present on responses; computed by
  // join, not stored.
  use_count: number;
};

export type SectionSource = 'manual' | 'auto';

export type Section = {
  id: string;
  project_id: string;
  start_ms: number;
  // Either song_id+song_name are populated (the section references a song
  // in the band catalog), or label is populated (free-text marker like
  // "warmup" / "false start"), or all three are null (an unnamed boundary
  // — manual flow doesn't emit these, but they're allowed by the schema
  // so the future auto-detector can drop boundaries before they're named).
  song_id: string | null;
  song_name: string | null;
  label: string | null;
  source: SectionSource;
  created_at: number;
  updated_at: number;
};

// Auto-classification (Stage 1 + Stage 2) types. See
// ~/projects/plans/2026-05-15-paperstem-auto-section-classification-design.md.

export type SegmentType =
  | 'music'
  | 'chatter'
  | 'tuning'
  | 'silence'
  | 'count_in'
  | 'unknown';

// Top-K AudioSet predictions stored alongside an auto section so the
// rule-based namer can be re-evaluated without re-running YAMNet.
export type TopClass = { name: string; score: number };

// Stage 1 output per segment. The client (web or CLI) uploads an array of
// these to POST /api/projects/:id/classify.
export type ClassifiedSegment = {
  start_ms: number;
  end_ms: number;
  segment_type: SegmentType;
  top_classes: TopClass[];
  // Beat-rate chroma vectors, present only when segment_type === 'music'.
  // Length = number of frames (typically a few hundred), each 12 floats.
  chroma?: number[][];
};

export type ClassificationRunStatus = 'pending' | 'running' | 'done' | 'failed';
export type ClassificationSourceSurface = 'web' | 'cli';

export type ClassificationRun = {
  id: string;
  project_id: string;
  status: ClassificationRunStatus;
  source_surface: ClassificationSourceSurface;
  audio_hash: string;
  classifier_version: string;
  fingerprint_version: number;
  error: string | null;
  created_at: number;
  completed_at: number | null;
};

// Extension fields stored on `sections` rows produced by auto-classification.
// NULL on rows with source='manual'.
export type AutoSectionFields = {
  confidence: number | null;
  run_id: string | null;
  segment_type: SegmentType | null;
  top_classes: TopClass[] | null;
};
