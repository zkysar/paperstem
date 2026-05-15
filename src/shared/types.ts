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
};

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
