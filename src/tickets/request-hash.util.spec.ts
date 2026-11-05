import { describe, expect, it } from 'vitest';

import { claimIdentity, hashRequest } from './request-hash.util.js';

const ticket = { ticketId: 'T-1', customerEmail: 'a@b.com', orderId: 'ORD-1001', subject: 's', body: 'b' };

describe('hashRequest', () => {
  it('is the same whatever order the keys arrive in', () => {
    const reversed = Object.fromEntries(Object.entries(ticket).reverse());
    expect(hashRequest(reversed)).toBe(hashRequest(ticket));
  });

  it('changes when any ticket field changes', () => {
    for (const field of Object.keys(ticket)) {
      expect(hashRequest({ ...ticket, [field]: 'changed' }), field).not.toBe(hashRequest(ticket));
    }
  });

  it('ignores the case and padding of the e-mail address', () => {
    expect(hashRequest({ ...ticket, customerEmail: ' A@B.COM ' })).toBe(hashRequest(ticket));
  });

  it('ignores fields that are not part of a ticket, since the agent ignores them too', () => {
    expect(hashRequest({ ...ticket, priority: 'high', client: 'zendesk' })).toBe(hashRequest(ticket));
  });

  it('rejects, instead of crashing the stack on, a deeply nested value', () => {
    let nested: unknown = 'x';
    for (let i = 0; i < 6000; i++) nested = [nested];
    expect(() => hashRequest({ ...ticket, subject: nested })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }),
    );
  });
});

describe('claimIdentity', () => {
  it('keys a claim by the ticket id and a digest of the sender, never the address itself', () => {
    const identity = claimIdentity(ticket)!;
    expect(identity.ticketId).toBe('T-1');
    expect(identity.claimKey).toMatch(/^T-1:[0-9a-f]{16}$/);
    expect(identity.claimKey).not.toContain('a@b.com');
  });

  it('gives different senders different keys for the same ticket id', () => {
    expect(claimIdentity({ ...ticket, customerEmail: 'x@y.com' })!.claimKey).not.toBe(claimIdentity(ticket)!.claimKey);
  });

  it('gives the same key for the same sender however the address is cased or padded', () => {
    expect(claimIdentity({ ...ticket, customerEmail: ' A@B.com ' })!.claimKey).toBe(claimIdentity(ticket)!.claimKey);
  });

  it('returns nothing when the id or the e-mail is not usable, so nothing is claimed', () => {
    const bad: unknown[] = [
      { ...ticket, ticketId: 'bad id!' },
      { ...ticket, ticketId: 5 },
      { ...ticket, ticketId: 'x'.repeat(41) },
      { ...ticket, customerEmail: 'no-at-sign' },
      { ...ticket, customerEmail: 7 },
      { ...ticket, customerEmail: `${'a'.repeat(201)}@b.com` },
      { ticketId: 'T-1' },
      {},
      null,
      'T-1',
    ];
    for (const raw of bad) expect(claimIdentity(raw), JSON.stringify(raw)?.slice(0, 60)).toBeUndefined();
  });
});
