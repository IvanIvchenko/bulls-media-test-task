import { describe, expect, it } from 'vitest';

import { RetentionRepository } from './retention.repository.js';
import { RetentionService } from './retention.service.js';
import { countRows } from '../../test/support/database.js';
import { NOW, createTestContainer } from '../../test/support/helpers.js';

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

async function setup() {
  const container = await createTestContainer();
  const db = container.database;
  const decision = (ticketId: string, createdAt: string) =>
    db('decisions').insert({
      ticket_id: ticketId,
      decision: 'deny',
      refund_amount: 0,
      flags: '',
      summary: 's',
      result_json: '{}',
      created_at: createdAt,
    });
  const claim = (ticketId: string, status: string, claimedAt: string) =>
    db('ticket_claims').insert({
      ticket_id: ticketId,
      request_hash: 'h',
      status,
      owner_token: 'o',
      claimed_at: claimedAt,
    });

  await decision('old-decision', daysAgo(120));
  await decision('recent-decision', daysAgo(10));
  await claim('old-done', 'done', daysAgo(120));
  await claim('recent-done', 'done', daysAgo(10));
  await claim('old-in-progress', 'in_progress', daysAgo(120));
  await db('refunds').insert({ order_id: 'ORD-1001', ticket_id: 'old-refund', amount: 59.9, created_at: daysAgo(400) });

  return { db, service: new RetentionService(new RetentionRepository(db), () => NOW) };
}

describe('RetentionService.prune', () => {
  it('deletes audit rows and finished claims older than the period, and reports how many', async () => {
    const { db, service } = await setup();
    expect(await service.prune(90)).toEqual({ decisions: 1, claims: 1 });
    expect(await db('decisions').pluck('ticket_id')).toEqual(['recent-decision']);
    expect((await db('ticket_claims').pluck('ticket_id')).sort()).toEqual(['old-in-progress', 'recent-done']);
  });

  it('never deletes a claim that is still in progress, however old', async () => {
    const { db, service } = await setup();
    await service.prune(1);
    expect(await db('ticket_claims').where({ ticket_id: 'old-in-progress' }).pluck('status')).toEqual(['in_progress']);
  });

  it('never deletes refunds: they are financial records', async () => {
    const { db, service } = await setup();
    await service.prune(1);
    expect(await countRows(db, 'refunds')).toBe(1);
  });

  it('keeps everything newer than the cutoff, and is exact at the boundary', async () => {
    const { db, service } = await setup();
    await db('decisions').insert({
      ticket_id: 'edge',
      decision: 'deny',
      refund_amount: 0,
      flags: '',
      summary: 's',
      result_json: '{}',
      created_at: daysAgo(90),
    });
    await service.prune(90);
    expect(await db('decisions').pluck('ticket_id')).toContain('edge'); // exactly 90 days old: not older than 90 days
  });

  it('does nothing the second time', async () => {
    const { service } = await setup();
    await service.prune(90);
    expect(await service.prune(90)).toEqual({ decisions: 0, claims: 0 });
  });

  it('refuses a period that is not a positive number, so a typo cannot delete everything', async () => {
    const { db, service } = await setup();
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(service.prune(bad)).rejects.toThrow(RangeError);
    }
    expect(await countRows(db, 'decisions')).toBe(2);
  });
});
