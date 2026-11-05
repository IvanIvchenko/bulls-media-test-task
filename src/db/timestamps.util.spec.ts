import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.client.js';
import { fromStoredTimestamp, toStoredTimestamp } from './timestamps.util.js';

describe('stored timestamps', () => {
  it('reads SQLite CURRENT_TIMESTAMP text as UTC, ISO text as is, and a Date unchanged', () => {
    expect(fromStoredTimestamp('2026-11-05 10:30:00').toISOString()).toBe('2026-11-05T10:30:00.000Z');
    expect(fromStoredTimestamp('2026-11-05T10:30:00.123Z').toISOString()).toBe('2026-11-05T10:30:00.123Z');
    const date = new Date('2026-11-05');
    expect(fromStoredTimestamp(date)).toBe(date);
  });

  it('writes a cutoff that compares correctly with what the database stamps itself', async () => {
    const database = await openDatabase(':memory:');
    const stamped = (await database.raw('select CURRENT_TIMESTAMP as t'))[0].t as string;
    const tomorrow = toStoredTimestamp(database, new Date(Date.now() + 86_400_000)) as string;
    const yesterday = toStoredTimestamp(database, new Date(Date.now() - 86_400_000)) as string;
    expect(yesterday < stamped && stamped < tomorrow).toBe(true);
    await database.destroy();
  });
});
