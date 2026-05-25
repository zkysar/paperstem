// Plan + fetch + decode self-contained MP3 segments. Byte offsets are nominal
// (CBR => linear in time); decodeSegment snaps to real frame boundaries.
// NOTE: firstFrameStart / lastCompleteFrameEnd imports are omitted here — Task 3
// adds the fetch/decode code and will import from './mp3-frames' at that point.

/** Reservoir reaches back <=511 B; 2 KB lead-in safely covers it (seam spike). */
export const LEAD_IN_BYTES = 2048;
export const DEFAULT_SEGMENT_SEC = 20;

export type PlannedSegment = {
  index: number;
  byteStart: number; // nominal content start of this segment
  byteEnd: number; // nominal content end (EOF for the last)
  fetchStart: number; // byteStart minus lead-in, clamped to 0
  leadInBytes: number; // bytes fetched before byteStart (0 for segment 0)
};

export function planSegments(
  totalBytes: number,
  totalSec: number,
  segSec: number = DEFAULT_SEGMENT_SEC,
): PlannedSegment[] {
  if (totalBytes <= 0 || totalSec <= 0) return [];
  const count = Math.max(1, Math.ceil(totalSec / segSec));
  const bytesPerSeg = totalBytes / count;
  const out: PlannedSegment[] = [];
  for (let k = 0; k < count; k++) {
    const byteStart = k === 0 ? 0 : Math.floor(bytesPerSeg * k);
    const byteEnd = k === count - 1 ? totalBytes : Math.floor(bytesPerSeg * (k + 1));
    const leadInBytes = k === 0 ? 0 : LEAD_IN_BYTES;
    out.push({
      index: k,
      byteStart,
      byteEnd,
      fetchStart: Math.max(0, byteStart - leadInBytes),
      leadInBytes,
    });
  }
  return out;
}
