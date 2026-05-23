// Pure logic for streaming a stem's audio in segments instead of decoding the
// whole file up front. The player (usePlayer) owns the Web Audio scheduling,
// fetching, and decode; this module owns the arithmetic so it can be unit
// tested without a browser. Nothing here touches `fetch`, `AudioContext`, or
// the DOM.

export type Segment = {
  index: number;
  startSec: number;
  endSec: number;
};

export type SegmentPlan = {
  segmentSec: number;
  durationSec: number;
  count: number;
  segments: Segment[];
};

export type WindowConfig = {
  // Seconds of already-played audio to keep decoded behind the playhead (so a
  // small back-seek or loop doesn't re-fetch). Everything older is evicted.
  behindSec: number;
  // Seconds to keep decoded ahead of the playhead — the read-ahead buffer.
  aheadSec: number;
};

export type WindowSelection = {
  // Segment indices that should be decoded for the current playhead, ascending.
  needed: number[];
  // Subset of `needed` not yet decoded, ordered by fetch priority: the segment
  // under the playhead first, then forward (read-ahead), then backward.
  toFetch: number[];
  // Currently-decoded indices that fell outside the window — free their memory.
  toEvict: number[];
};

export type ByteRange = {
  // Half-open [start, end). HTTP Range is inclusive, so a caller forms the
  // header as `bytes=${start}-${end - 1}`.
  start: number;
  end: number;
};

export const DEFAULT_SEGMENT_SEC = 20;

// Read-ahead far enough that a fast connection never stalls, with a small
// behind-window so loop-backs and nudge-seeks stay warm.
export const DEFAULT_WINDOW: WindowConfig = { behindSec: 10, aheadSec: 40 };

// MPEG-1 Layer III's `main_data_begin` is a 9-bit field, so the bit reservoir
// reaches back at most 511 bytes. Prepending this many bytes before a segment's
// first frame guarantees the reservoir is repopulated, so a segment decoded
// from an arbitrary cut point reconstructs without artifacts. Measured on
// Paperstem's own 64 kbps re-encodes, the worst-case backpointer was 511 B.
export const RESERVOIR_MAX_BYTES = 512;

export function planSegments(
  durationSec: number,
  segmentSec: number = DEFAULT_SEGMENT_SEC,
): SegmentPlan {
  const dur = durationSec > 0 && isFinite(durationSec) ? durationSec : 0;
  const seg = segmentSec > 0 && isFinite(segmentSec) ? segmentSec : DEFAULT_SEGMENT_SEC;
  const count = dur > 0 ? Math.ceil(dur / seg) : 0;
  const segments: Segment[] = [];
  for (let index = 0; index < count; index++) {
    // index * seg rather than an accumulator so float error can't drift the
    // boundaries over a long file.
    const startSec = index * seg;
    segments.push({ index, startSec, endSec: Math.min(startSec + seg, dur) });
  }
  return { segmentSec: seg, durationSec: dur, count, segments };
}

export function segmentIndexAt(plan: SegmentPlan, timeSec: number): number {
  if (plan.count === 0) return 0;
  if (!(timeSec > 0) || !isFinite(timeSec)) return 0;
  return Math.max(0, Math.min(plan.count - 1, Math.floor(timeSec / plan.segmentSec)));
}

export function selectWindow(
  plan: SegmentPlan,
  playheadSec: number,
  decoded: ReadonlySet<number>,
  window: WindowConfig = DEFAULT_WINDOW,
): WindowSelection {
  if (plan.count === 0) {
    return { needed: [], toFetch: [], toEvict: [...decoded].sort((a, b) => a - b) };
  }
  const lo = segmentIndexAt(plan, Math.max(0, playheadSec - window.behindSec));
  const hi = segmentIndexAt(plan, playheadSec + window.aheadSec);
  const cur = segmentIndexAt(plan, playheadSec);

  const needed: number[] = [];
  for (let i = lo; i <= hi; i++) needed.push(i);

  // Priority: the playhead's segment, then forward, then backward.
  const ordered: number[] = [];
  for (let i = cur; i <= hi; i++) ordered.push(i);
  for (let i = cur - 1; i >= lo; i--) ordered.push(i);
  const toFetch = ordered.filter((i) => !decoded.has(i));

  const neededSet = new Set(needed);
  const toEvict = [...decoded].filter((i) => !neededSet.has(i)).sort((a, b) => a - b);

  return { needed, toFetch, toEvict };
}

// End time (sec) of the unbroken run of decoded segments starting at
// `fromIndex`. This is how far playback can safely advance from that point. If
// `fromIndex` itself isn't decoded, nothing is buffered there yet, so the
// frontier is that segment's start.
export function contiguousFrontierSec(
  plan: SegmentPlan,
  decoded: ReadonlySet<number>,
  fromIndex: number,
): number {
  if (plan.count === 0) return 0;
  const from = Math.max(0, Math.min(plan.count - 1, fromIndex));
  if (!decoded.has(from)) return plan.segments[from].startSec;
  let i = from;
  while (i + 1 < plan.count && decoded.has(i + 1)) i++;
  return plan.segments[i].endSec;
}

// The mix can only play where every active stem is buffered, so the playable
// frontier is the minimum of each active stem's contiguous frontier.
// `perStemDecoded` should already exclude muted/un-soloed stems — they don't
// gate playback. With no gating stems (everything muted), nothing constrains
// playback, so the frontier is the whole duration: the silent mix plays freely
// rather than stalling at 0.
export function mixFrontierSec(
  plan: SegmentPlan,
  perStemDecoded: ReadonlyArray<ReadonlySet<number>>,
  fromIndex: number,
): number {
  if (!perStemDecoded.length) return plan.durationSec;
  let min = Infinity;
  for (const decoded of perStemDecoded) {
    const f = contiguousFrontierSec(plan, decoded, fromIndex);
    if (f < min) min = f;
  }
  return min === Infinity ? 0 : min;
}

// Byte range to fetch for one segment of a constant-bitrate file (Paperstem's
// >100 MB uploads are re-encoded to 64 kbps CBR MP3, where byte offset is
// linear in time). `headerBytes` is the size of any ID3/Xing header before the
// first audio frame. Non-first segments include a reservoir lead-in; the caller
// snaps `start` to the next frame sync and trims the lead-in after decode.
// Returns null when inputs can't yield a meaningful range.
export function planCbrByteRange(args: {
  startSec: number;
  endSec: number;
  durationSec: number;
  fileByteLength: number;
  headerBytes?: number;
  leadInBytes?: number;
}): ByteRange | null {
  const headerBytes = args.headerBytes ?? 0;
  const leadInBytes = args.leadInBytes ?? RESERVOIR_MAX_BYTES;
  if (!(args.durationSec > 0) || !(args.fileByteLength > headerBytes)) return null;

  const audioBytes = args.fileByteLength - headerBytes;
  const bytesPerSec = audioBytes / args.durationSec;
  const isFirst = args.startSec <= 0;
  const isLast = args.endSec >= args.durationSec;

  const rawStart = headerBytes + Math.floor(Math.max(0, args.startSec) * bytesPerSec);
  const start = isFirst ? headerBytes : Math.max(headerBytes, rawStart - leadInBytes);
  // The final segment runs to EOF so the encoder's flushed tail is included.
  const rawEnd = headerBytes + Math.ceil(args.endSec * bytesPerSec);
  const end = isLast ? args.fileByteLength : Math.min(args.fileByteLength, Math.max(rawEnd, start + 1));

  return { start, end };
}

// Leading PCM samples to drop after decoding an overlap-extended segment so the
// buffer begins exactly at the segment's start. `decodedStartSec` is the song
// time of the first decoded sample (earlier than `segmentStartSec` by the
// lead-in); `decoderDelaySamples` accounts for a decoder's fixed priming.
export function leadInTrimSamples(
  decodedStartSec: number,
  segmentStartSec: number,
  sampleRate: number,
  decoderDelaySamples = 0,
): number {
  if (!(sampleRate > 0) || !isFinite(sampleRate)) return 0;
  const lead = Math.max(0, segmentStartSec - decodedStartSec);
  return Math.round(lead * sampleRate) + Math.max(0, decoderDelaySamples);
}
