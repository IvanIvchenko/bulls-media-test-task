import { describe, expect, it } from 'vitest';

import { isBusyError, retryOnBusy } from './busy-retry.util.js';

const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
const noPause = () => {};

describe('retryOnBusy', () => {
  it('returns the result straight away when nothing is busy', () => {
    let calls = 0;
    expect(retryOnBusy(() => ++calls, noPause)).toBe(1);
  });

  it('tries again after BUSY and returns the first success', () => {
    let calls = 0;
    const result = retryOnBusy(() => {
      if (++calls < 3) throw busy();
      return 'ok';
    }, noPause);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('rethrows any other error immediately', () => {
    let calls = 0;
    expect(() =>
      retryOnBusy(() => {
        calls++;
        throw new Error('syntax error');
      }, noPause),
    ).toThrow('syntax error');
    expect(calls).toBe(1);
  });

  it('gives up after a bounded number of attempts and rethrows the busy error', () => {
    let calls = 0;
    expect(() =>
      retryOnBusy(() => {
        calls++;
        throw busy();
      }, noPause),
    ).toThrow('database is locked');
    expect(calls).toBe(60);
  });

  it('recognises every SQLITE_BUSY flavour but nothing else', () => {
    expect(isBusyError(busy())).toBe(true);
    expect(isBusyError(Object.assign(new Error(), { code: 'SQLITE_BUSY_SNAPSHOT' }))).toBe(true);
    expect(isBusyError(Object.assign(new Error(), { code: 'SQLITE_CONSTRAINT_UNIQUE' }))).toBe(false);
    expect(isBusyError(new Error('plain'))).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});
