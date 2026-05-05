import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from './rate-limit.js';

describe('TokenBucketLimiter', () => {
  it('allows the first request and blocks the second within the window', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketLimiter(1, 60_000, () => now);
    expect(limiter.tryConsume('a@example.com')).toBe(true);
    expect(limiter.tryConsume('a@example.com')).toBe(false);
  });

  it('refills after the interval elapses', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketLimiter(1, 60_000, () => now);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    now += 60_000;
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
  });

  it('does not refill before the interval elapses', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketLimiter(1, 60_000, () => now);
    expect(limiter.tryConsume('a')).toBe(true);
    now += 59_999;
    expect(limiter.tryConsume('a')).toBe(false);
    now += 1;
    expect(limiter.tryConsume('a')).toBe(true);
  });

  it('caps at capacity even after a long idle period', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketLimiter(2, 60_000, () => now);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    now += 600_000;
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
  });

  it('keeps separate buckets per key', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketLimiter(1, 60_000, () => now);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('b')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(false);
  });

  it('reset() clears all buckets', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketLimiter(1, 60_000, () => now);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    limiter.reset();
    expect(limiter.tryConsume('a')).toBe(true);
  });
});
