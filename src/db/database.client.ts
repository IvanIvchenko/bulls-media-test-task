import knex from 'knex';

import { retryAsyncOnBusy, retryOnBusy } from './busy-retry.util.js';
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_MEMORY } from './constants.js';
import { migrate } from './database.migrator.js';
import { seedIfEmpty } from './database.seed.js';
import { withInitLock } from './init-lock.util.js';
import type { Database, OpenOptions, SqliteConnection } from './typedef.js';

type AfterCreateDone = (error: Error | null, connection: SqliteConnection) => void;

function configureSqlite(connection: SqliteConnection, path: string): void {
  // First, so that waiting for another process's lock works for everything that follows.
  connection.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  if (path !== SQLITE_MEMORY) connection.pragma('journal_mode = WAL'); // readers do not block the writer
  connection.pragma('foreign_keys = ON');
}

/** Create the handle. Nothing touches the database yet; `openDatabase` also migrates and seeds. */
function connect(path: string): Database {
  return knex({
    client: 'better-sqlite3',
    connection: { filename: path },
    useNullAsDefault: true,
    // One connection: an in-memory database exists only inside its connection, and SQLite allows one writer anyway.
    // It also keeps two connections of one process from waiting on each other: the driver is synchronous, so a
    // lock wait blocks the thread that would have to release the lock.
    pool: {
      min: 1,
      max: 1,
      afterCreate: (connection: SqliteConnection, done: AfterCreateDone) => {
        try {
          // Safe to repeat, so a BUSY from a process starting at the same moment just means "try again".
          retryOnBusy(() => configureSqlite(connection, path));
          done(null, connection);
        } catch (error) {
          done(error as Error, connection);
        }
      },
    },
  });
}

/**
 * Connect, bring the schema up to date and seed any empty tables. ":memory:" gives a fresh, isolated database,
 * which is what tests and `npm run samples` use. Safe to run in several processes at once.
 */
export async function openDatabase(path: string = SQLITE_MEMORY, options: OpenOptions = {}): Promise<Database> {
  const database = connect(path);
  try {
    await retryAsyncOnBusy(() =>
      withInitLock(database, async (trx) => {
        await migrate(trx);
        await seedIfEmpty(trx, options);
      }),
    );
  } catch (error) {
    await database.destroy();
    throw error;
  }
  return database;
}
