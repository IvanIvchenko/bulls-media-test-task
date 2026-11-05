import type { Ports } from '../../src/container.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Small seeded generator (mulberry32), so a failure can be reproduced. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrap every method of a port so it answers after a 1..maxMs delay (seeded): a slow, remote database. */
export function withLatency<T extends object>(port: T, maxMs = 15, seed = 1): T {
  const random = seededRandom(seed);
  return new Proxy(port, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await sleep(1 + random() * maxMs);
        return value.apply(target, args);
      };
    },
  });
}

export const slowPorts = (ports: Ports, maxMs?: number): Ports => ({
  orders: withLatency(ports.orders, maxMs),
  policies: withLatency(ports.policies, maxMs),
  audit: withLatency(ports.audit, maxMs),
  reviews: withLatency(ports.reviews, maxMs),
});
