import { describe, it, expect, beforeEach, vi } from 'vitest';

// The semaphore uses module-level mutable state (active counter + waiters queue).
// We use vi.resetModules() + a fresh dynamic import before each test so each
// test gets a zeroed-out copy of those counters.

describe('concurrency semaphore', () => {
  let acquire: () => Promise<() => void>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./concurrency.js');
    acquire = mod.acquire;
  });

  it('allows up to MAX_CONCURRENT (3) simultaneous acquires without blocking', async () => {
    const rel1 = await acquire();
    const rel2 = await acquire();
    const rel3 = await acquire();

    expect(rel1).toBeTypeOf('function');
    expect(rel2).toBeTypeOf('function');
    expect(rel3).toBeTypeOf('function');

    rel1();
    rel2();
    rel3();
  });

  it('queues a 4th acquire until one slot is released', async () => {
    const rel1 = await acquire();
    const rel2 = await acquire();
    const rel3 = await acquire();

    let fourthResolved = false;
    const fourthPromise = acquire().then((rel) => {
      fourthResolved = true;
      return rel;
    });

    // Flush microtasks — the 4th acquire is still waiting.
    await Promise.resolve();
    expect(fourthResolved).toBe(false);

    rel1(); // free one slot — wakes the 4th waiter
    const rel4 = await fourthPromise;
    expect(fourthResolved).toBe(true);

    rel2();
    rel3();
    rel4();
  });

  it('re-allows immediate acquires after slots are released', async () => {
    const rel1 = await acquire();
    const rel2 = await acquire();
    rel1();
    rel2();

    // After releasing, acquiring again must resolve immediately.
    const rel3 = await acquire();
    expect(rel3).toBeTypeOf('function');
    rel3();
  });

  it('processes waiters in FIFO order', async () => {
    const rel1 = await acquire();
    const rel2 = await acquire();
    const rel3 = await acquire();

    const order: number[] = [];

    const p4 = acquire().then((rel) => { order.push(4); return rel; });
    const p5 = acquire().then((rel) => { order.push(5); return rel; });
    const p6 = acquire().then((rel) => { order.push(6); return rel; });

    rel1();
    const rel4 = await p4;
    rel2();
    const rel5 = await p5;
    rel3();
    const rel6 = await p6;

    expect(order).toEqual([4, 5, 6]);

    rel4();
    rel5();
    rel6();
  });

  it('handles many sequential single-slot round-trips without drift', async () => {
    for (let i = 0; i < 9; i++) {
      const rel = await acquire();
      rel();
    }
    // If active underflowed or overflow logic broke, this would either resolve
    // immediately (too permissive) or never resolve (stuck). Both would be caught
    // by the test timing out or by the assertions below.
    const rel = await acquire();
    expect(rel).toBeTypeOf('function');
    rel();
  });
});
