type Bucket = {
  tokens: number;
  lastRefill: number;
};

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillIntervalMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  tryConsume(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      if (elapsed >= this.refillIntervalMs) {
        const refills = Math.floor(elapsed / this.refillIntervalMs);
        bucket.tokens = Math.min(this.capacity, bucket.tokens + refills);
        bucket.lastRefill += refills * this.refillIntervalMs;
      }
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export const authRequestLimiter = new TokenBucketLimiter(1, 60_000);
