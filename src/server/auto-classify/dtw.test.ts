import { describe, it, expect } from 'vitest';
import { dtwDistance } from './dtw.js';

describe('dtwDistance', () => {
  it('returns 0 for identical sequences', () => {
    const a = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    expect(dtwDistance(a, a)).toBeCloseTo(0, 5);
  });

  it('is small for shifted but similar sequences', () => {
    const a = [[1, 0], [0, 1], [1, 0]];
    const b = [[1, 0], [1, 0], [0, 1], [1, 0]]; // a stretched
    const same = dtwDistance(a, b);
    // Should still be small because the path can align them.
    expect(same).toBeLessThan(0.2);
  });

  it('is larger for genuinely different sequences', () => {
    const a = [[1, 0], [1, 0], [1, 0]];
    const b = [[0, 1], [0, 1], [0, 1]];
    const cross = dtwDistance(a, b);
    // Orthogonal vectors yield cost=1 per frame; with the (n+m) path
    // normalization that lower-bounds at 0.5 for genuinely different sequences.
    expect(cross).toBeGreaterThanOrEqual(0.5);
  });

  it('throws on empty input', () => {
    expect(() => dtwDistance([], [[1, 0]])).toThrow();
    expect(() => dtwDistance([[1, 0]], [])).toThrow();
  });
});
