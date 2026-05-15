// Median-filter smoothing + segment derivation over per-window class
// predictions from YAMNet. Output is a list of ClassifiedSegments
// (without chroma — that's filled in later by the orchestrator only for
// music segments).
import type {
  ClassifiedSegment,
  SegmentType,
  TopClass,
} from '../../../shared/types';

const DEFAULT_MEDIAN_RADIUS = 2; // 5-window kernel
const DEFAULT_MIN_SEGMENT_MS = 4000;
const TOP_CLASSES_K = 5;

function medianFilter(
  classes: SegmentType[],
  radius: number,
): SegmentType[] {
  const out: SegmentType[] = [];
  for (let i = 0; i < classes.length; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(classes.length, i + radius + 1);
    const counts = new Map<SegmentType, number>();
    for (let j = lo; j < hi; j++) {
      const c = classes[j];
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: SegmentType = classes[i];
    let bestN = 0;
    for (const [c, n] of counts) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    out.push(best);
  }
  return out;
}

/**
 * Aggregate top_classes across the windows that make up a single output
 * segment by averaging scores per AudioSet name. Returned list is sorted by
 * score desc and capped at TOP_CLASSES_K.
 */
function aggregateTopClasses(windows: TopClass[][]): TopClass[] {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const w of windows) {
    for (const tc of w) {
      const cur = sums.get(tc.name) ?? { sum: 0, count: 0 };
      cur.sum += tc.score;
      cur.count += 1;
      sums.set(tc.name, cur);
    }
  }
  const merged: TopClass[] = [];
  for (const [name, { sum, count }] of sums) {
    merged.push({ name, score: sum / count });
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, TOP_CLASSES_K);
}

export type SmoothOpts = {
  minSegmentMs?: number;
  medianRadius?: number;
};

/**
 * Take per-window class predictions, smooth noise via a median filter, merge
 * contiguous same-class windows into segments, then absorb short segments
 * into their neighbours. Returns ClassifiedSegment[] without chroma.
 */
export function smoothAndSegment(
  classes: SegmentType[],
  topPerWindow: TopClass[][],
  windowMs: number,
  opts: SmoothOpts = {},
): ClassifiedSegment[] {
  if (classes.length === 0) return [];
  if (classes.length !== topPerWindow.length) {
    throw new Error(
      `smoothAndSegment: classes/topPerWindow length mismatch ` +
        `(${classes.length} vs ${topPerWindow.length})`,
    );
  }
  const minMs = opts.minSegmentMs ?? DEFAULT_MIN_SEGMENT_MS;
  const radius = opts.medianRadius ?? DEFAULT_MEDIAN_RADIUS;

  const smoothed = medianFilter(classes, radius);

  // First pass: merge contiguous same-class windows.
  type Raw = { startIdx: number; endIdx: number; segment_type: SegmentType };
  const raw: Raw[] = [];
  for (let i = 0; i < smoothed.length; i++) {
    const c = smoothed[i];
    const last = raw[raw.length - 1];
    if (last && last.segment_type === c) last.endIdx = i + 1;
    else raw.push({ startIdx: i, endIdx: i + 1, segment_type: c });
  }

  // Second pass: absorb segments shorter than minMs into their neighbours.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < raw.length; i++) {
      const seg = raw[i];
      const lengthMs = (seg.endIdx - seg.startIdx) * windowMs;
      if (lengthMs < minMs && raw.length > 1) {
        const left = raw[i - 1];
        const right = raw[i + 1];
        let target: Raw;
        if (!left) target = right;
        else if (!right) target = left;
        else
          target =
            left.endIdx - left.startIdx >= right.endIdx - right.startIdx
              ? left
              : right;
        target.startIdx = Math.min(target.startIdx, seg.startIdx);
        target.endIdx = Math.max(target.endIdx, seg.endIdx);
        raw.splice(i, 1);
        changed = true;
        break;
      }
    }
    // Re-collapse adjacent same-class segments produced by absorption.
    for (let i = raw.length - 1; i > 0; i--) {
      if (raw[i].segment_type === raw[i - 1].segment_type) {
        raw[i - 1].endIdx = raw[i].endIdx;
        raw.splice(i, 1);
        changed = true;
      }
    }
  }

  return raw.map((r) => ({
    start_ms: r.startIdx * windowMs,
    end_ms: r.endIdx * windowMs,
    segment_type: r.segment_type,
    top_classes: aggregateTopClasses(topPerWindow.slice(r.startIdx, r.endIdx)),
  }));
}
