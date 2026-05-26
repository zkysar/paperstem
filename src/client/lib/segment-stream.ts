// Plan + fetch + decode self-contained MP3 segments. Byte offsets are nominal
// (CBR => linear in time); decodeSegment snaps to real frame boundaries.

import { firstFrameStart, lastCompleteFrameEnd, sampleRateOf } from './mp3-frames';

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

export type SegmentBytes = { bytes: Uint8Array; totalBytes: number };

/** Range-fetch [fetchStart, byteEnd). Total file size comes from Content-Range. */
export async function fetchSegmentBytes(
  url: string,
  fetchStart: number,
  byteEnd: number,
): Promise<SegmentBytes> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { Range: `bytes=${fetchStart}-${byteEnd - 1}` },
  });
  // 206 (partial) is the expected Range status; 200 means the server ignored
  // Range and returned the whole file (our server supports Range, so unexpected).
  if (!res.ok) throw new Error(`segment fetch ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const cr = res.headers.get('content-range'); // "bytes a-z/total"
  const total = cr ? Number(cr.split('/')[1]) : bytes.length;
  return { bytes, totalBytes: Number.isFinite(total) ? total : bytes.length };
}

export type DecodeOpts = { isFirst: true } | { isFirst: false; leadInSec: number };

/**
 * Snap to MP3 frame boundaries, decode at the file's NATIVE sample rate (via an
 * OfflineAudioContext so a 48 kHz file isn't resampled into a 44.1 kHz live
 * context with an inconsistent phase — that caused an audible seam in testing),
 * and trim the lead-in samples for non-first segments.
 */
export async function decodeSegment(raw: Uint8Array, opts: DecodeOpts): Promise<AudioBuffer> {
  const start = opts.isFirst ? 0 : firstFrameStart(raw);
  const end = lastCompleteFrameEnd(raw);
  const aligned = raw.subarray(start, end);
  if (aligned.length === 0) {
    throw new Error('decodeSegment: no complete MP3 frame in the given byte range');
  }
  const rate = sampleRateOf(aligned) || 44100;
  const Ctor =
    (globalThis as any).OfflineAudioContext ?? (globalThis as any).webkitOfflineAudioContext;
  const off: OfflineAudioContext = new Ctor(1, 1, rate);
  // decodeAudioData detaches its input; pass a standalone ArrayBuffer copy.
  const decoded = await off.decodeAudioData(aligned.slice().buffer);
  // opts.isFirst || short-circuits so that TS narrows the union before reading leadInSec.
  if (opts.isFirst || opts.leadInSec <= 0) return decoded;

  const drop = Math.min(decoded.length, Math.round(opts.leadInSec * decoded.sampleRate));
  const keep = decoded.length - drop;
  if (keep <= 0) return decoded;
  const out = off.createBuffer(decoded.numberOfChannels, keep, decoded.sampleRate);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    out.getChannelData(ch).set(decoded.getChannelData(ch).subarray(drop));
  }
  return out;
}
