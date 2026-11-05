import { INIT_LOCK_TABLE } from './constants.js';
import type { Database, Transaction } from './typedef.js';

/**
 * Run `work` in a transaction that no other process can run at the same time. Startup (migrations and seeding)
 * must not interleave between instances that boot together.
 *
 * SQLite: a real write as the first statement takes the file's write lock, so the next process waits (busy
 * timeout) until this transaction ends. A read first would risk a lock-upgrade deadlock.
 * (This is the one place besides `database.client.ts` that is specific to the database. Another SQL database
 * would take an advisory lock here instead.)
 */
export async function withInitLock<T>(database: Database, work: (trx: Transaction) => Promise<T>): Promise<T> {
  return database.transaction(async (trx) => {
    await trx.raw(`CREATE TABLE IF NOT EXISTS ${INIT_LOCK_TABLE} (id INTEGER PRIMARY KEY)`);
    await trx.raw(`INSERT OR REPLACE INTO ${INIT_LOCK_TABLE} (id) VALUES (1)`);
    return work(trx);
  });
}
