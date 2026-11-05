import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from '../../src/db/database.client.js';
import type { Database, OpenOptions } from '../../src/db/typedef.js';

/** A fresh, isolated database with the seed policy (and the seed orders unless `options.orders` is given). */
export async function openTestDatabase(options: OpenOptions = {}): Promise<Database> {
  return openDatabase(':memory:', options);
}

export interface SharedDatabase {
  /** Open as many handles as you like: they all see the same data, like separate instances of the service. */
  path: string;
  /** Remove the file. */
  cleanup(): Promise<void>;
}

/** A SQLite file several OS processes can share. */
export async function createSharedDatabase(): Promise<SharedDatabase> {
  const dir = mkdtempSync(join(tmpdir(), 'triage-shared-'));
  return {
    path: join(dir, 'shared.db'),
    cleanup: async () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Number of rows in a table. */
export async function countRows(database: Database, table: string): Promise<number> {
  const row = await database(table).count('* as n').first();
  return Number(row?.n ?? 0);
}
