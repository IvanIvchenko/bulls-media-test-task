import { describe, expect, it } from 'vitest';

import { fromStoredTimestamp } from './timestamps.util.js';

describe('stored timestamps', () => {
  it('reads SQLite CURRENT_TIMESTAMP text as UTC, ISO text as is, and a Date unchanged', () => {
    expect(fromStoredTimestamp('2026-11-05 10:30:00').toISOString()).toBe('2026-11-05T10:30:00.000Z');
    expect(fromStoredTimestamp('2026-11-05T10:30:00.123Z').toISOString()).toBe('2026-11-05T10:30:00.123Z');
    const date = new Date('2026-11-05');
    expect(fromStoredTimestamp(date)).toBe(date);
  });
});
