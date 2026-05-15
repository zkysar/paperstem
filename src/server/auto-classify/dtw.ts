/**
 * Dynamic Time Warping distance between two sequences of vectors.
 * Uses cosine distance as the per-frame cost. Result is normalized by
 * the path length so sequences of different durations are comparable.
 */
export function dtwDistance(a: number[][], b: number[][]): number {
  if (a.length === 0 || b.length === 0) {
    throw new Error('dtwDistance: empty sequence');
  }
  const n = a.length;
  const m = b.length;
  const dim = a[0].length;

  // Precompute norms for cosine distance.
  const normA = new Float64Array(n);
  const normB = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += a[i][d] * a[i][d];
    normA[i] = Math.sqrt(s) || 1;
  }
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += b[j][d] * b[j][d];
    normB[j] = Math.sqrt(s) || 1;
  }

  const cost = (i: number, j: number): number => {
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += a[i][d] * b[j][d];
    return 1 - dot / (normA[i] * normB[j]);
  };

  // Two-row DP buffer.
  let prev = new Float64Array(m + 1).fill(Infinity);
  let cur = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    cur[0] = Infinity;
    for (let j = 1; j <= m; j++) {
      const c = cost(i - 1, j - 1);
      cur[j] = c + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }

  return prev[m] / (n + m);
}
