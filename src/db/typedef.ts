import type { Knex } from 'knex';

import type { Order } from '../domain/index.js';

/**
 * The database handle every repository uses: a Knex instance. Repositories never see the driver, so a
 * different SQL database only changes how this handle is created (`database.client.ts`) and the startup lock.
 */
export type Database = Knex;
export type Transaction = Knex.Transaction;

export interface OpenOptions {
  /** Seed these orders instead of data/seed/orders.json (used by tests). Ignored if the table already has rows. */
  orders?: Order[];
  /** Fill an empty orders table with the demo customers. Default true; production turns it off. */
  seedSampleOrders?: boolean;
}

/** The raw SQLite connection Knex hands to `afterCreate`. */
export interface SqliteConnection {
  pragma(statement: string, options?: { simple?: boolean }): unknown;
}

export interface Migration {
  /** Unique and ordered by name, e.g. "001-initial-schema". Applied migrations are never changed, only added to. */
  name: string;
  up(database: Database | Transaction): Promise<void>;
}
