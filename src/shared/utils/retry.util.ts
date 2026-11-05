import { setTimeout as delay } from 'node:timers/promises';

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries: number;
  /** The first wait; each retry doubles it. */
  baseMs?: number;
  /** Return false for an error that retrying cannot fix, so it is thrown at once. Defaults to retrying everything. */
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
  /** Injectable so tests need not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable so tests are deterministic. Returns a number in [0, 1). */
  random?: () => number;
}

const DEFAULT_BASE_MS = 200;

/**
 * Retry with exponential backoff and "equal jitter": each wait is half fixed, half random, so several callers that
 * failed together do not retry together.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    retries,
    baseMs = DEFAULT_BASE_MS,
    shouldRetry = () => true,
    sleep = (ms) => delay(ms),
    random = Math.random,
  } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      options.onRetry?.(error, attempt + 1);
      const ceiling = baseMs * 2 ** attempt;
      await sleep(ceiling / 2 + (ceiling / 2) * random());
    }
  }
}
