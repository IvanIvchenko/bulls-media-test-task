import { describe, expect, it } from 'vitest';

import { MockLlmService } from './mock.service.js';

const mentioned = async (body: string, subject = 'Hello') =>
  (await new MockLlmService().classify({ ticketId: 'T-1', customerEmail: 'a@b.com', subject, body })).value
    .orderIdMentioned;

describe('MockLlmService order ids', () => {
  it('normalises the ways customers write an order id, as the real model is asked to', async () => {
    for (const text of ['order #1001', 'my order ord-1001', 'ORD 1001 please', 'ORD-1001', 'Ord-1001.']) {
      expect(await mentioned(text), text).toBe('ORD-1001');
    }
  });

  it('finds no order id where there is none', async () => {
    for (const text of ['Where is my parcel?', 'I paid 1001 euros', 'order #12', 'ORD-123456789']) {
      expect(await mentioned(text), text).toBeNull();
    }
  });

  it('also looks in the subject', async () => {
    expect(await mentioned('Please refund me.', 'Refund for #2002')).toBe('ORD-2002');
  });
});
