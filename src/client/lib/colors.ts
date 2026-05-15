// Stem palette — assigned by index, wraps if more stems than colors.
export const PALETTE: readonly string[] = [
  '#c17446', '#8a6a3f', '#5e7a4e', '#3b6675',
  '#7d4e6b', '#a87a3f', '#594b76', '#9f4a4a',
];

// Annotation author palette — five hues distinct from the brand accent
// (which is reserved for the calling user's annotations). Stable mapping
// by user id so each band member keeps the same color across sessions.
export const ANNOTATION_PALETTE: readonly string[] = [
  '#3b6675',
  '#5e7a4e',
  '#7d4e6b',
  '#a87a3f',
  '#594b76',
  '#9f4a4a',
];

// Brand accent — the color used for the calling user's annotations.
// Kept in sync with --accent in app.css.
export const SELF_ANNOTATION_COLOR = '#c17446';

export function paletteIndexForUserId(
  userId: string,
  paletteSize: number,
): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % paletteSize;
}

export function colorForAnnotationAuthor(
  userId: string,
  selfUserId: string,
): string {
  if (userId === selfUserId) return SELF_ANNOTATION_COLOR;
  return ANNOTATION_PALETTE[
    paletteIndexForUserId(userId, ANNOTATION_PALETTE.length)
  ];
}

// Build a stable user_id → color map from the current set of annotation
// authors. Self gets the brand accent. Non-self authors are sorted by
// user_id and assigned palette colors by rank, guaranteeing distinct hues
// for up to ANNOTATION_PALETTE.length unique non-self authors. Beyond that
// the palette wraps and collisions become possible — acceptable at band
// scale (max ~6 members per design doc).
export function buildUserColorMap(
  userIds: Iterable<string>,
  selfUserId: string,
): Map<string, string> {
  const out = new Map<string, string>();
  out.set(selfUserId, SELF_ANNOTATION_COLOR);
  const seen = new Set<string>();
  for (const id of userIds) {
    if (id !== selfUserId) seen.add(id);
  }
  const sorted = [...seen].sort();
  for (let i = 0; i < sorted.length; i++) {
    out.set(sorted[i], ANNOTATION_PALETTE[i % ANNOTATION_PALETTE.length]);
  }
  return out;
}

// Song chapter palette — distinct hues that read well as tinted band fills
// on top of the waveform. Eight colors is plenty for the chip-rail and the
// chapter lane; collisions on a band with 30+ active songs are acceptable
// (it's a navigation hint, not data).
export const SONG_PALETTE: readonly string[] = [
  '#3b6675',
  '#5e7a4e',
  '#7d4e6b',
  '#a87a3f',
  '#594b76',
  '#9f4a4a',
  '#c17446',
  '#4a7080',
];

// Deterministic color for a song. Same id always returns the same hue,
// so "Heart Sounds" looks the same across every practice without needing
// a stored color column.
export function colorForSong(songId: string): string {
  let h = 0;
  for (let i = 0; i < songId.length; i++) {
    h = ((h << 5) - h + songId.charCodeAt(i)) | 0;
  }
  return SONG_PALETTE[Math.abs(h) % SONG_PALETTE.length];
}

// Neutral fill for sections that have a free-text label rather than a
// song reference, and for unnamed boundaries.
export const FREE_TEXT_SECTION_COLOR = '#6a6a6a';

// Mix two #rrggbb hex colors. t=0 returns a, t=1 returns b.
export function mix(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
  const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0');
}
