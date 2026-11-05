import { describe, expect, it } from 'vitest';

import { isRetryableLlmError } from './retryable.util.js';

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('isRetryableLlmError', () => {
  it.each([408, 409, 429, 500, 502, 503, 504, 529])(
    'retries HTTP %i (timeout, conflict, rate limit, server trouble)',
    (status) => {
      expect(isRetryableLlmError(http(status))).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 413, 422])('does not retry HTTP %i, which would fail the same way again', (status) => {
    expect(isRetryableLlmError(http(status))).toBe(false);
  });

  it('retries failures that have no status: a dropped connection, a timeout, output that failed validation', () => {
    for (const error of [
      new Error('socket hang up'),
      new TypeError('fetch failed'),
      { name: 'ZodError' },
      'text',
      null,
      undefined,
    ]) {
      expect(isRetryableLlmError(error)).toBe(true);
    }
  });
});
