import { describe, expect, it } from 'vitest';

import { backdateClaim, createTestContainer } from '../../test/support/helpers.js';
import type { Result } from '../domain/index.js';

const result: Result = {
  ticketId: 'T-1',
  decision: 'approve',
  refundAmount: 10,
  intent: 'refund_request',
  reasons: ['ok'],
  policyCitations: [],
  handoff: null,
  flags: [],
  reply: 'ok',
  summary: 's',
  trace: [],
  usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0 },
};

const claims = async () => (await createTestContainer()).claims;

describe('ClaimsService', () => {
  it('lets exactly one caller claim a ticket id', async () => {
    const service = await claims();
    const first = await service.tryClaim('T-1', 'hash');
    expect(first).toEqual(expect.any(String));
    expect(await service.tryClaim('T-1', 'hash')).toBeUndefined();
    expect(await service.tryClaim('T-2', 'hash')).toEqual(expect.any(String)); // other ids are independent
  });

  it('picks one winner among many simultaneous callers', async () => {
    const service = await claims();
    const tokens = await Promise.all(Array.from({ length: 25 }, () => service.tryClaim('T-1', 'hash')));
    expect(tokens.filter(Boolean)).toHaveLength(1);
  });

  it('reports an in-progress claim, then the stored result once it is done', async () => {
    const service = await claims();
    const token = (await service.tryClaim('T-1', 'hash'))!;
    expect(await service.find('T-1')).toMatchObject({
      ticketId: 'T-1',
      requestHash: 'hash',
      status: 'in_progress',
      ownerToken: token,
    });
    expect((await service.find('T-1'))?.ageMs).toBeLessThan(5_000);
    expect((await service.find('T-1'))?.result).toBeUndefined();

    expect(await service.complete('T-1', token, result)).toBe(true);
    expect(await service.find('T-1')).toMatchObject({ status: 'done', result });
  });

  it('reads a decision stored before usage was recorded, as zero usage', async () => {
    const container = await createTestContainer();
    const older: Partial<Result> = { ...result };
    delete older.usage;
    await container.database('ticket_claims').insert({
      ticket_id: 'T-OLD',
      request_hash: 'h',
      status: 'done',
      owner_token: 'o',
      result_json: JSON.stringify(older),
      claimed_at: new Date().toISOString(),
    });
    expect((await container.claims.find('T-OLD'))?.result?.usage).toEqual({
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      llmMs: 0,
    });
  });

  it('replaces the decision of a finished claim, and only of a finished one', async () => {
    const service = await claims();
    const token = (await service.tryClaim('T-1', 'hash'))!;
    expect(await service.replaceResult('T-1', result)).toBe(false); // still in progress: nothing to replace
    await service.complete('T-1', token, result);
    expect(await service.replaceResult('T-1', { ...result, reply: 'changed' })).toBe(true);
    expect((await service.find('T-1'))?.result?.reply).toBe('changed');
    expect(await service.replaceResult('T-404', result)).toBe(false);
  });

  it('knows nothing about an unclaimed ticket', async () => {
    expect(await (await claims()).find('T-404')).toBeUndefined();
  });

  it('only lets the current owner finish or give the ticket back', async () => {
    const service = await claims();
    const token = (await service.tryClaim('T-1', 'hash'))!;
    expect(await service.complete('T-1', 'someone-else', result)).toBe(false);
    await service.release('T-1', 'someone-else');
    expect((await service.find('T-1'))?.status).toBe('in_progress'); // a stranger's release did nothing

    await service.release('T-1', token);
    expect(await service.find('T-1')).toBeUndefined();
    expect(await service.tryClaim('T-1', 'hash')).toEqual(expect.any(String)); // free to claim again
  });

  it('never gives back or overwrites a finished decision', async () => {
    const service = await claims();
    const token = (await service.tryClaim('T-1', 'hash'))!;
    await service.complete('T-1', token, result);
    await service.release('T-1', token);
    expect(await service.complete('T-1', token, { ...result, reply: 'changed' })).toBe(false);
    expect((await service.find('T-1'))?.result?.reply).toBe('ok');
  });

  it("measures a claim's age by the database clock", async () => {
    const container = await createTestContainer();
    await container.claims.tryClaim('T-1', 'hash');
    await backdateClaim(container.database, 'T-1', 120_000);
    const age = (await container.claims.find('T-1'))!.ageMs;
    expect(age).toBeGreaterThanOrEqual(119_000);
    expect(age).toBeLessThan(125_000);
  });

  describe('takeOver', () => {
    it('hands a claim to one new owner and invalidates the old token', async () => {
      const service = await claims();
      const oldToken = (await service.tryClaim('T-1', 'hash'))!;
      const newToken = await service.takeOver('T-1', oldToken);
      expect(newToken).toEqual(expect.any(String));
      expect(newToken).not.toBe(oldToken);
      expect(await service.complete('T-1', oldToken, result)).toBe(false);
      expect(await service.complete('T-1', newToken!, result)).toBe(true);
    });

    it('lets only one of several successors win', async () => {
      const service = await claims();
      const oldToken = (await service.tryClaim('T-1', 'hash'))!;
      const winners = await Promise.all(Array.from({ length: 10 }, () => service.takeOver('T-1', oldToken)));
      expect(winners.filter(Boolean)).toHaveLength(1);
    });

    it('cannot take over a finished claim or one that is not there', async () => {
      const service = await claims();
      const token = (await service.tryClaim('T-1', 'hash'))!;
      await service.complete('T-1', token, result);
      expect(await service.takeOver('T-1', token)).toBeUndefined();
      expect(await service.takeOver('T-404', 'token')).toBeUndefined();
    });
  });
});
