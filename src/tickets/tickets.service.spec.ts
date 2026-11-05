import { describe, expect, it, vi } from 'vitest';

import { claimIdentity, hashRequest } from './request-hash.util.js';
import { TicketsService } from './tickets.service.js';
import type { TicketsOptions } from './typedef.js';
import { backdateClaim, createTestContainer } from '../../test/support/helpers.js';
import { FLAG, type Result, type TicketClaims } from '../domain/index.js';

const resultFor = (ticketId: string, flags: string[] = []): Result => ({
  ticketId,
  decision: 'approve',
  refundAmount: 10,
  intent: 'refund_request',
  reasons: [],
  policyCitations: [],
  handoff: null,
  flags,
  reply: 'ok',
  summary: 's',
  trace: [],
  usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0 },
});

const CONFLICT = { code: 'TICKET_ID_CONFLICT', status: 409 };
const RAW = { ticketId: 'T-1', customerEmail: 'a@b.com', body: 'a' };
const CLAIM_KEY = claimIdentity(RAW)!.claimKey;

/** A fake agent that counts calls and can be held open. Claims are the real, database-backed ones. */
async function setup(options: Partial<TicketsOptions> = {}, sharedClaims?: TicketClaims) {
  const container = await createTestContainer();
  const claims = sharedClaims ?? container.claims;
  const calls: unknown[] = [];
  let release: () => void = () => {};
  let gate: Promise<void> | undefined;
  const agent = {
    run: async (raw: unknown) => {
      calls.push(raw);
      await gate;
      return resultFor((raw as { ticketId: string }).ticketId);
    },
  };
  const tickets = new TicketsService(claims, agent, {
    staleAfterMs: 60_000,
    waitMs: 1_000,
    pollMs: 5,
    reviewsEnabled: false,
    monotonicMs: () => performance.now(),
    ...options,
  });
  return {
    claims,
    database: container.database,
    calls,
    tickets,
    hold: () => {
      gate = new Promise<void>((resolve) => (release = resolve));
    },
    release: () => release(),
  };
}

describe('TicketsService', () => {
  it('runs a new ticket once and replays it afterwards', async () => {
    const { tickets, calls } = await setup();
    expect((await tickets.process(RAW)).kind).toBe('ran');
    expect((await tickets.process(RAW)).kind).toBe('replayed');
    expect((await tickets.process({ body: 'a', customerEmail: 'a@b.com', ticketId: 'T-1' })).kind).toBe('replayed'); // key order is irrelevant
    expect(calls).toHaveLength(1);
  });

  it('replays exactly the decision that was stored', async () => {
    const { tickets } = await setup();
    const first = await tickets.process(RAW);
    const second = await tickets.process(RAW);
    expect(second.result).toEqual(first.result);
  });

  it('throws a conflict when the id is reused with a different payload', async () => {
    const { tickets, calls } = await setup();
    await tickets.process(RAW);
    await expect(tickets.process({ ticketId: 'T-1', customerEmail: 'a@b.com', body: 'b' })).rejects.toMatchObject(
      CONFLICT,
    );
    expect(calls).toHaveLength(1);
  });

  it('makes a duplicate wait for the running ticket instead of running twice', async () => {
    const { tickets, calls, hold, release } = await setup();
    hold();
    const first = tickets.process(RAW);
    const second = tickets.process(RAW);
    await expect(tickets.process({ ticketId: 'T-1', customerEmail: 'a@b.com', body: 'other' })).rejects.toMatchObject(
      CONFLICT,
    ); // even in flight
    release();
    expect((await first).kind).toBe('ran');
    expect((await second).kind).toBe('replayed');
    expect(calls).toHaveLength(1);
  });

  it('tells a duplicate to retry when the owner takes too long, without running a second time', async () => {
    const { tickets, calls, hold, release } = await setup({ waitMs: 40 });
    hold();
    const owner = tickets.process(RAW);
    await expect(tickets.process(RAW)).rejects.toMatchObject({ code: 'TICKET_IN_PROGRESS', status: 409 });
    release();
    await owner;
    expect(calls).toHaveLength(1);
  });

  it('lets two instances sharing one database race for the same ticket: one runs it', async () => {
    const { claims } = await setup();
    const a = await setup({}, claims);
    const b = await setup({}, claims);
    a.hold();
    b.hold();
    const results = [a.tickets.process(RAW), b.tickets.process(RAW)];
    a.release();
    b.release();
    const kinds = (await Promise.all(results)).map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(['ran', 'replayed']);
    expect(a.calls.length + b.calls.length).toBe(1);
  });

  it('gives the id back when the agent throws, so a retry can run', async () => {
    const { claims } = await setup();
    let attempt = 0;
    const tickets = new TicketsService(
      claims,
      {
        run: async (raw) => {
          if (attempt++ === 0) throw new Error('boom');
          return resultFor((raw as { ticketId: string }).ticketId);
        },
      },
      { staleAfterMs: 60_000, waitMs: 1_000, pollMs: 5, reviewsEnabled: false, monotonicMs: () => performance.now() },
    );
    await expect(tickets.process(RAW)).rejects.toThrow('boom');
    expect((await tickets.process(RAW)).kind).toBe('ran');
  });

  it('does not treat a malformed ticket id as an idempotency key', async () => {
    const { tickets, calls } = await setup();
    await tickets.process({ ticketId: 'bad id!!', customerEmail: 'a@b.com', body: 'a' });
    await tickets.process({ ticketId: 'bad id!!', customerEmail: 'a@b.com', body: 'a' });
    expect(calls).toHaveLength(2);
  });

  it('does not let a request rejected as invalid claim its id', async () => {
    const { claims } = await setup();
    const results = [resultFor('T-1', [FLAG.INVALID_INPUT]), resultFor('T-1')];
    const tickets = new TicketsService(
      claims,
      { run: async () => results.shift()! },
      {
        staleAfterMs: 60_000,
        waitMs: 1_000,
        pollMs: 5,
        reviewsEnabled: false,
        monotonicMs: () => performance.now(),
      },
    );
    expect((await tickets.process({ ticketId: 'T-1', customerEmail: 'a@b.com', body: '' })).kind).toBe('ran'); // rejected, id handed back
    expect((await tickets.process({ ticketId: 'T-1', customerEmail: 'a@b.com', body: 'fixed' })).kind).toBe('ran'); // different payload is fine
    expect((await tickets.process({ ticketId: 'T-1', customerEmail: 'a@b.com', body: 'fixed' })).kind).toBe('replayed');
  });

  it('gives up waiting by its monotonic clock, not by how many polls it made', async () => {
    let elapsed = 0;
    const { tickets, hold, release, calls } = await setup({
      waitMs: 1_000,
      pollMs: 1,
      monotonicMs: () => (elapsed += 400), // every look at the clock costs 400 ms
    });
    hold();
    const owner = tickets.process(RAW);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await expect(tickets.process(RAW)).rejects.toMatchObject({ code: 'TICKET_IN_PROGRESS' });
    release();
    await owner;
  });

  describe('when the owner of a claim has died', () => {
    const crashedClaim = async (claims: TicketClaims, database: Awaited<ReturnType<typeof setup>>['database']) => {
      const token = await claims.tryClaim(CLAIM_KEY, hashRequest(RAW));
      await backdateClaim(database, CLAIM_KEY, 120_000); // claimed two minutes ago
      return token;
    };

    it('takes the ticket over once the claim is stale, and runs it', async () => {
      const { claims, database, tickets, calls } = await setup({ staleAfterMs: 60_000 });
      await crashedClaim(claims, database);
      expect((await tickets.process(RAW)).kind).toBe('ran');
      expect(calls).toHaveLength(1);
      expect((await tickets.process(RAW)).kind).toBe('replayed');
    });

    it('does not take over a claim that is merely slow', async () => {
      const { claims, database, tickets, calls } = await setup({ staleAfterMs: 600_000, waitMs: 30 });
      await crashedClaim(claims, database);
      await expect(tickets.process(RAW)).rejects.toMatchObject({ code: 'TICKET_IN_PROGRESS' });
      expect(calls).toHaveLength(0);
    });

    it('locks the dead owner out: if it comes back and tries to finish, it is refused', async () => {
      const { claims, database, tickets } = await setup({ staleAfterMs: 60_000 });
      const deadOwnerToken = await crashedClaim(claims, database);
      await tickets.process(RAW); // a new owner takes over and finishes
      expect(await claims.complete(CLAIM_KEY, deadOwnerToken!, resultFor('T-1', ['stale']))).toBe(false);
      expect((await tickets.process(RAW)).result.flags).not.toContain('stale');
    });

    it('lets exactly one of several waiting callers take the ticket over', async () => {
      const { claims, database } = await setup();
      await crashedClaim(claims, database);
      const instances = await Promise.all([setup({}, claims), setup({}, claims), setup({}, claims)]);
      const outcomes = await Promise.all(instances.map((instance) => instance.tickets.process(RAW)));
      expect(outcomes.filter((outcome) => outcome.kind === 'ran')).toHaveLength(1);
      expect(instances.reduce((sum, instance) => sum + instance.calls.length, 0)).toBe(1);
    });
  });

  describe('claims are tied to the sender as well as the ticket id', () => {
    const mine = { ticketId: 'T-1042', customerEmail: 'me@example.com', body: 'my refund' };
    const theirs = { ...mine, customerEmail: 'someone.else@example.com', body: 'their refund' };

    it("does not let one customer use up another customer's ticket id", async () => {
      const { tickets, calls } = await setup();
      expect((await tickets.process(theirs)).kind).toBe('ran'); // a stranger sends T-1042 first
      expect((await tickets.process(mine)).kind).toBe('ran'); // the real owner is not told it clashes
      expect(calls).toHaveLength(2);
    });

    it('still treats the same sender with a changed payload as a clash', async () => {
      const { tickets } = await setup();
      await tickets.process(mine);
      await expect(tickets.process({ ...mine, body: 'a different request' })).rejects.toMatchObject(CONFLICT);
    });

    it('treats the same sender with a differently cased address as the same ticket', async () => {
      const { tickets, calls } = await setup();
      await tickets.process(mine);
      expect((await tickets.process({ ...mine, customerEmail: 'ME@Example.com' })).kind).toBe('replayed');
      expect(calls).toHaveLength(1);
    });
  });
});
