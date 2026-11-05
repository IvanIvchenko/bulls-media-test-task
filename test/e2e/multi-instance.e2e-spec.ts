import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/database.client.js';
import { claimIdentity, hashRequest } from '../../src/tickets/request-hash.util.js';
import { countRows, createSharedDatabase, type SharedDatabase } from '../support/database.js';
import { backdateClaim, createTestContainer, ticket } from '../support/helpers.js';

/*
 * Several instances sharing one database file, as when a service is scaled out. Each instance is a real,
 * separate OS process.
 *
 * Why processes and not two containers in this one: better-sqlite3 is synchronous. A connection waiting for a
 * lock that another connection in the SAME process holds blocks the thread, so the holder can never finish and
 * release it. One SQLite connection per process is the rule (Knex's pool is capped at one).
 */

let shared: SharedDatabase;
beforeEach(async () => {
  shared = await createSharedDatabase();
});
afterEach(async () => shared.cleanup());

const WORKER = resolve(import.meta.dirname, '../support/claim-worker.ts');

/** Run the worker in its own process and return what it printed. */
const runWorker = (payload: unknown, env: Record<string, string> = {}) =>
  new Promise<{ kind: string; decision: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', WORKER, shared.path, JSON.stringify(payload)], {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`worker exited with ${code}: ${stderr}`));
      resolveRun(JSON.parse(stdout.trim().split('\n').pop()!));
    });
  });

/** Count rows from a fresh connection, once the workers are done. */
const count = async (table: string) => {
  const db = await openDatabase(shared.path);
  try {
    return await countRows(db, table);
  } finally {
    await db.destroy();
  }
};

describe('separate OS processes, one database file', () => {
  it('start on a brand-new file at the same moment without breaking each other (seeding is race-safe)', async () => {
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => runWorker(ticket())));
    expect(outcomes).toHaveLength(4);
    expect(await count('policy_rules')).toBe(10); // seeded exactly once, not 4 times or not at all
    expect(await count('orders')).toBe(9);
  }, 60_000);

  it('process an identical ticket exactly once between them', async () => {
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => runWorker(ticket())));

    expect(outcomes.filter((outcome) => outcome.kind === 'ran')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'replayed')).toHaveLength(3);
    expect(new Set(outcomes.map((outcome) => outcome.decision))).toEqual(new Set(['approve']));
    expect(await count('refunds')).toBe(1);
    expect(await count('decisions')).toBe(1);
  }, 60_000);

  it('refund an order once even when different tickets for it run in different processes', async () => {
    const outcomes = await Promise.all(['R-1', 'R-2', 'R-3', 'R-4'].map((ticketId) => runWorker(ticket({ ticketId }))));

    expect(outcomes.filter((outcome) => outcome.decision === 'approve')).toHaveLength(1);
    expect(await count('refunds')).toBe(1);
    expect(await count('decisions')).toBe(4);
  }, 60_000);

  it('let exactly one process take over a ticket whose owner died mid-run', async () => {
    // An instance claimed the ticket two minutes ago and then died without finishing. Make that claim here, then
    // release this process's connection before the workers start.
    const dead = await createTestContainer({ database: await openDatabase(shared.path) });
    const claimKey = claimIdentity(ticket())!.claimKey;
    expect(await dead.claims.tryClaim(claimKey, hashRequest(ticket()))).toBeDefined();
    await backdateClaim(dead.database, claimKey, 120_000);
    await dead.close();

    // A claim older than a minute counts as abandoned.
    const outcomes = await Promise.all([1, 2, 3].map(() => runWorker(ticket(), { CLAIM_STALE_AFTER_MS: '60000' })));

    expect(outcomes.filter((outcome) => outcome.kind === 'ran')).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => outcome.decision))).toEqual(new Set(['approve']));
    expect(await count('refunds')).toBe(1);
    expect(await count('decisions')).toBe(1);
  }, 60_000);
});
