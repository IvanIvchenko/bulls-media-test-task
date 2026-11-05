import type { Database } from './typedef.js';

const SQLITE_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Read a timestamp column back as a Date. SQLite's `CURRENT_TIMESTAMP` is "YYYY-MM-DD HH:MM:SS" in UTC with no
 * zone, rows written by the app are ISO strings, and other databases return a Date.
 */
export function fromStoredTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  return new Date(SQLITE_FORMAT.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

/** A Date as a value comparable with columns the database stamped itself (`database.fn.now()`). */
export function toStoredTimestamp(database: Database, date: Date): string | Date {
  const client = String(database.client.config.client);
  return client.includes('sqlite') ? date.toISOString().slice(0, 19).replace('T', ' ') : date;
}
