// Stem palette — assigned by index, wraps if more stems than colors.
export const PALETTE: readonly string[] = [
  '#c17446', '#8a6a3f', '#5e7a4e', '#3b6675',
  '#7d4e6b', '#a87a3f', '#594b76', '#9f4a4a',
];

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
