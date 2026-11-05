import { describe, expect, it } from 'vitest';

import { reviewKeyOf } from './review-key.util.js';

const ticket = (over: Record<string, unknown> = {}) => ({ ticketId: 'T-1', customerEmail: 'a@b.com', ...over });

describe('reviewKeyOf', () => {
  it('is the ticket id and a digest of the sender, never the address itself', () => {
    const key = reviewKeyOf(ticket())!;
    expect(key).toMatch(/^T-1:[0-9a-f]{16}$/);
    expect(key).not.toContain('a@b.com');
  });

  it('gives different senders different keys for the same ticket id', () => {
    expect(reviewKeyOf(ticket({ customerEmail: 'x@y.com' }))).not.toBe(reviewKeyOf(ticket()));
  });

  it('gives the same key for the same sender however the address is cased or padded', () => {
    expect(reviewKeyOf(ticket({ customerEmail: '  A@B.com ' }))).toBe(reviewKeyOf(ticket()));
  });

  it('gives different tickets from one sender different keys', () => {
    expect(reviewKeyOf(ticket({ ticketId: 'T-2' }))).not.toBe(reviewKeyOf(ticket()));
  });

  it('returns nothing when the id or the e-mail is not usable, or the request is not an object', () => {
    for (const bad of [
      ticket({ ticketId: 'bad id!' }),
      ticket({ ticketId: 5 }),
      ticket({ customerEmail: 'nope' }),
      ticket({ customerEmail: 'a@b.com'.padEnd(300, 'x') }),
      {},
      null,
      'text',
      [],
    ]) {
      expect(reviewKeyOf(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});
