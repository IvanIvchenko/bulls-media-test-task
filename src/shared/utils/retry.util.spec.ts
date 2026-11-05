import { describe, expect, it } from 'vitest';

import { withRetry } from './retry.util.js';

/** Collects the waits instead of sleeping. */
const harness = (random = () => 0) => {
  const waits: number[] = [];
  return { waits, options: { sleep: async (ms: number) => void waits.push(ms), random } };
};

describe('withRetry', () => {
  it('returns the first success without waiting', async () => {
    const { waits, options } = harness();
    expect(await withRetry(async () => 'ok', { retries: 3, ...options })).toBe('ok');
    expect(waits).toEqual([]);
  });

  it('tries again after a failure, up to the limit, then throws the last error', async () => {
    const { options } = harness();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`failure ${calls}`);
        },
        { retries: 2, ...options },
      ),
    ).rejects.toThrow('failure 3');
    expect(calls).toBe(3); // the first attempt plus two retries
  });

  it('returns a later success', async () => {
    const { options } = harness();
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw new Error('flaky');
        return 'ok';
      },
      { retries: 3, ...options },
    );
    expect([result, calls]).toEqual(['ok', 3]);
  });

  it('does not retry an error that retrying cannot fix', async () => {
    const { waits, options } = harness();
    let calls = 0;
    const fatal = Object.assign(new Error('bad key'), { fatal: true });
    await expect(
      withRetry(
        async () => {
          calls++;
          throw fatal;
        },
        { retries: 5, shouldRetry: (e) => !(e as { fatal?: boolean }).fatal, ...options },
      ),
    ).rejects.toBe(fatal);
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  describe('backoff', () => {
    it('doubles each time, between half and the full amount (jitter)', async () => {
      for (const [random, factor] of [
        [() => 0, 0.5],
        [() => 0.999999, 1],
      ] as const) {
        const { waits, options } = harness(random);
        await withRetry(
          async (attempt) => {
            if (attempt < 3) throw new Error('x');
          },
          { retries: 3, baseMs: 100, ...options },
        );
        expect(waits.map((ms) => Math.round(ms))).toEqual([100 * factor, 200 * factor, 400 * factor].map(Math.round));
      }
    });

    it('never waits longer than the doubling schedule, whatever the random number', async () => {
      const { waits, options } = harness(() => 1);
      await withRetry(
        async (n) => {
          if (n < 2) throw new Error('x');
        },
        { retries: 2, baseMs: 50, ...options },
      );
      expect(waits).toEqual([50, 100]);
    });
  });
});
