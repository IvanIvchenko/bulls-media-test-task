import { setTimeout as delay } from 'node:timers/promises';

const MAX_ATTEMPTS = 60;
const MAX_BACKOFF_MS = 100;

export function isBusyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

const backoffMs = (attempt: number) => Math.min(MAX_BACKOFF_MS, 5 * attempt);

/** Block this thread for a moment. Used only while opening a SQLite connection, before any request is served. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `work` again if SQLite reports BUSY. SQLite's busy timeout does not cover every case: for example,
 * switching a new file to WAL mode while another process is doing the same fails at once. `work` must be safe
 * to repeat. Gives up after a bounded number of attempts (a few seconds) and rethrows the last error.
 */
export function retryOnBusy<T>(work: () => T, pauseMs: (ms: number) => void = pause): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return work();
    } catch (error) {
      if (!isBusyError(error) || attempt >= MAX_ATTEMPTS) throw error;
      pauseMs(backoffMs(attempt));
    }
  }
}

/** The same for asynchronous work, such as running migrations through a connection pool. */
export async function retryAsyncOnBusy<T>(
  work: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => delay(ms),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!isBusyError(error) || attempt >= MAX_ATTEMPTS) throw error;
      await sleep(backoffMs(attempt));
    }
  }
}
