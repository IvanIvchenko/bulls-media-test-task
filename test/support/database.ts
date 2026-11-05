import { openDatabase } from '../../src/db/database.client.js';
import type { Database, OpenOptions } from '../../src/db/typedef.js';

/** A fresh, isolated database with the seed policy (and the seed orders unless `options.orders` is given). */
export async function openTestDatabase(options: OpenOptions = {}): Promise<Database> {
  return openDatabase(':memory:', options);
}

/** Number of rows in a table. */
export async function countRows(database: Database, table: string): Promise<number> {
  const row = await database(table).count('* as n').first();
  return Number(row?.n ?? 0);
}
