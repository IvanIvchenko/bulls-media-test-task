import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import RawSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.client.js';
import { migrate } from './database.migrator.js';
import { countRows, openTestDatabase } from '../../test/support/database.js';
import { NOW, createTestContainer } from '../../test/support/helpers.js';
import { ConfigService } from '../config/config.service.js';
import { createContainer } from '../container.js';
import { MockLlmService } from '../llm/mock.service.js';

const containerOnFile = async (path: string) =>
  createContainer({
    config: ConfigService.fromObject({}),
    database: await openDatabase(path),
    llm: new MockLlmService(),
  });

const withTempDir = async <T>(prefix: string, work: (dir: string) => Promise<T>): Promise<T> => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('database', () => {
  it('creates the schema and seeds orders, rules, settings and category rules', async () => {
    const db = await openTestDatabase();
    expect(await countRows(db, 'orders')).toBe(9);
    expect(await countRows(db, 'policy_rules')).toBe(10);
    expect(await countRows(db, 'policy_settings')).toBe(3);
    expect(await countRows(db, 'category_rules')).toBe(2);
    for (const empty of ['refunds', 'decisions', 'pending_reviews']) expect(await countRows(db, empty)).toBe(0);
    await db.destroy();
  });

  it('the schema itself rejects invalid data, double refunds and dangling references', async () => {
    const db = await openTestDatabase();
    const order = () => db('orders').where({ order_id: 'ORD-1001' });
    await expect(order().update({ amount: -1 })).rejects.toThrow(/check/i);
    await expect(order().update({ category: 'bogus' })).rejects.toThrow(/check/i);
    await expect(order().update({ status: 'teleported' })).rejects.toThrow(/check/i);

    const refund = (orderId: string) =>
      db('refunds').insert({ order_id: orderId, ticket_id: 'T', amount: 1, created_at: NOW.toISOString() });
    await refund('ORD-1001');
    await expect(refund('ORD-1001')).rejects.toThrow(/unique/i);
    await expect(refund('NOPE')).rejects.toThrow(/foreign key/i);

    await expect(
      db('pending_reviews').insert({
        review_id: 'T:x',
        ticket_id: 'T',
        order_id: 'ORD-1',
        thread_id: 't',
        status: 'weird',
        request_json: '{}',
      }),
    ).rejects.toThrow(/check/i);
    await db.destroy();
  });

  it('recordRefund writes the order flag and the refund row atomically', async () => {
    const { database: db, orders: store } = await createTestContainer();
    expect(await store.recordRefund('ORD-1001', 'T-9', 59.9, NOW)).toEqual({ ok: true });
    expect(await db('refunds').where({ order_id: 'ORD-1001' }).first('ticket_id', 'amount')).toEqual({
      ticket_id: 'T-9',
      amount: 59.9,
    });
    expect((await store.recordRefund('ORD-1001', 'T-10', 59.9, NOW)).ok).toBe(false);
    expect(await countRows(db, 'refunds')).toBe(1); // the failed second attempt left nothing behind
    await db.destroy();
  });

  it('refuses to start against a database whose rules do not match the code', async () => {
    const container = await createTestContainer();
    await container.database('policy_rules').where({ id: 'R7' }).del(); // nothing references R7
    await expect(container.verify()).rejects.toThrow(/R7/);
    await container.close();
  });
});

describe('seeding', () => {
  it('can leave the demo orders out while still installing the policy the service cannot run without', async () => {
    const db = await openDatabase(':memory:', { seedSampleOrders: false });
    expect([await countRows(db, 'policy_rules'), await countRows(db, 'orders')]).toEqual([10, 0]);
    await db.destroy();
  });

  it('inserts orders that are passed in explicitly, whatever the flag says', async () => {
    const order = {
      orderId: 'ORD-9999',
      customerEmail: 'x@y.com',
      item: 'Thing',
      category: 'physical',
      amount: 5,
      status: 'delivered',
      deliveredAt: '2026-10-01',
      refunded: false,
    } as const;
    const db = await openDatabase(':memory:', { orders: [order], seedSampleOrders: false });
    expect(await db('orders').pluck('order_id')).toEqual(['ORD-9999']);
    await db.destroy();
  });

  it('never adds demo orders to a table that already has real ones', async () => {
    await withTempDir('triage-seed-', async (dir) => {
      const path = join(dir, 'store.db');
      const first = await openDatabase(path, { seedSampleOrders: false });
      await first('orders').insert({
        order_id: 'ORD-5000',
        customer_email: 'real@y.com',
        item: 'Real',
        category: 'physical',
        amount: 10,
        status: 'delivered',
        delivered_at: '2026-10-01',
        refunded: false,
      });
      await first.destroy();

      const again = await openDatabase(path); // asking for demo data now must not mix it with the real orders
      expect(await again('orders').pluck('order_id')).toEqual(['ORD-5000']);
      await again.destroy();
    });
  });
});

describe('migrations', () => {
  it('run once: applying them again changes nothing', async () => {
    const db = await openTestDatabase();
    expect(await db.transaction((trx) => migrate(trx))).toEqual([]);
    expect(await db('schema_migrations').pluck('name')).toEqual([
      '001-initial-schema',
      '002-defect-claims-need-review',
      '003-pending-reviews',
      '004-quotable-policy-text',
    ]);
    await db.destroy();
  });

  describe('002: defect claims need review', () => {
    const OLD_R2 =
      'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery.';
    const rerun = async (db: Awaited<ReturnType<typeof openTestDatabase>>) => {
      await db('schema_migrations').where({ name: '002-defect-claims-need-review' }).del();
      await db.transaction((trx) => migrate(trx));
      return (await db('policy_rules').where({ id: 'R2' }).first('text'))!.text as string;
    };

    it('brings the stored rule text of an older database in line with the code', async () => {
      const db = await openTestDatabase();
      await db('policy_rules').where({ id: 'R2' }).update({ text: OLD_R2 });
      expect(await rerun(db)).toMatch(/escalate it to a human/);
      await db.destroy();
    });

    it('leaves a rule alone that someone has already edited', async () => {
      const db = await openTestDatabase();
      await db('policy_rules').where({ id: 'R2' }).update({ text: 'Our own wording.' });
      expect(await rerun(db)).toBe('Our own wording.');
      await db.destroy();
    });
  });
});

describe('004: quotable policy text', () => {
  /** How each reworded rule read before, as shipped. */
  const SHIPPED: Record<string, string> = {
    R2: 'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery. After {{return_window_days}} days the claim cannot be checked automatically: escalate it to a human.',
    R3: 'Digital goods and software licenses are non-refundable once delivered, except where required by law (escalate to a human).',
    R5: 'Refunds up to {{auto_approve_limit}} may be approved automatically. Refunds above {{auto_approve_limit}} require human review and must be escalated.',
    R7: 'A refund may only be processed when the ticket email matches the email on the order. Otherwise refuse and do not disclose order details.',
    S3: 'Requests unrelated to refunds or order status (account changes, product advice, complaints about staff, legal threats) are out of scope and must be routed to a human agent.',
  };
  const textOf = async (db: Awaited<ReturnType<typeof openTestDatabase>>, id: string) =>
    (await db('policy_rules').where({ id }).first('text'))!.text as string;
  const rerun = async (db: Awaited<ReturnType<typeof openTestDatabase>>) => {
    await db('schema_migrations').where({ name: '004-quotable-policy-text' }).del();
    await db.transaction((trx) => migrate(trx));
  };

  it('rewrites every rule that still reads as it was shipped, so an older database says what a new one does', async () => {
    const db = await openTestDatabase();
    const current = Object.fromEntries(
      await Promise.all(Object.keys(SHIPPED).map(async (id) => [id, await textOf(db, id)])),
    );
    for (const [id, text] of Object.entries(SHIPPED)) await db('policy_rules').where({ id }).update({ text });

    await rerun(db);
    for (const id of Object.keys(SHIPPED)) expect(await textOf(db, id), id).toBe(current[id]);
    await db.destroy();
  });

  it('also reaches the text that migration 002 left on R2', async () => {
    const db = await openTestDatabase();
    const current = await textOf(db, 'R2');
    await db('policy_rules').where({ id: 'R2' }).update({
      text: 'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery. After {{return_window_days}} days the claim cannot be checked automatically: escalate it to a human.',
    });
    await rerun(db);
    expect(await textOf(db, 'R2')).toBe(current);
    await db.destroy();
  });

  it('leaves a rule alone that someone has already reworded', async () => {
    const db = await openTestDatabase();
    await db('policy_rules').where({ id: 'R5' }).update({ text: 'Our own wording of the approval limit.' });
    await rerun(db);
    expect(await textOf(db, 'R5')).toBe('Our own wording of the approval limit.');
    await db.destroy();
  });
});

describe('a SQLite file', () => {
  it('persists, and reopening it neither re-seeds nor overwrites', async () => {
    await withTempDir('triage-db-', async (dir) => {
      const path = join(dir, 'store.db');
      const first = await containerOnFile(path);
      await first.orders.recordRefund('ORD-1001', 'T-1', 59.9, NOW);
      await first.database('policy_settings').where({ key: 'return_window_days' }).update({ value: 45 });
      await first.close();

      const second = await containerOnFile(path);
      expect(await countRows(second.database, 'orders')).toBe(9);
      expect(await second.orders.lookupOrder('ORD-1001', 'anna@example.com')).toMatchObject({
        order: { refunded: true },
      });
      expect((await second.policies.loadSnapshot()).config.returnWindow.days).toBe(45); // edit survived the reseed
      await second.close();
    });
  });

  it('is adopted, not rebuilt, when it was created before the current schema', async () => {
    await withTempDir('triage-migrate-', async (dir) => {
      const path = join(dir, 'old.db');
      const old = new RawSqlite(path);
      old.exec(`CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL, decision TEXT NOT NULL,
        refund_amount REAL NOT NULL, flags TEXT NOT NULL, summary TEXT NOT NULL,
        result_json TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT)`);
      old.prepare("INSERT INTO decisions VALUES (1, 'T-OLD', 'deny', 0, '', 's', '{}', 'x', 'hash')").run();
      old.close();

      const db = await openDatabase(path);
      expect(await db.schema.hasTable('pending_reviews')).toBe(true); // the tables it lacked were added
      expect(await countRows(db, 'decisions')).toBe(1); // and its rows were kept
      await db.destroy();
    });
  });

  it('sets the SQLite pragmas: a short wait for a locked file, readers beside the writer (WAL), foreign keys on', async () => {
    await withTempDir('triage-shared-', async (dir) => {
      const db = await openDatabase(join(dir, 'shared.db'));
      expect(((await db.raw('PRAGMA busy_timeout')) as { timeout: number }[])[0]?.timeout).toBe(5000);
      expect(((await db.raw('PRAGMA journal_mode')) as { journal_mode: string }[])[0]?.journal_mode).toBe('wal');
      expect(((await db.raw('PRAGMA foreign_keys')) as { foreign_keys: number }[])[0]?.foreign_keys).toBe(1);
      await db.destroy();
    });
  });
});
