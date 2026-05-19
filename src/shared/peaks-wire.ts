// Wire format for the `stems.peaks` column. v2 carries raw, un-normalized
// amplitudes in 0..255 as a "v2:"-prefixed CSV. The server validates this
// format on upload (src/server/projects.ts:validatePeaksString) and the
// player decodes it in src/client/lib/peaks.ts:decodePeaks.

export const PLAYER_PEAK_BINS = 2000;
export const WIRE_V2_PREFIX = 'v2:';

export function encodePeaksWireV2(peaks: number[]): string {
  return (
    WIRE_V2_PREFIX +
    peaks
      .map((p) => Math.round(Math.max(0, Math.min(1, p)) * 255))
      .join(',')
  );
}
