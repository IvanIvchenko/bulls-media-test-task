import { describe, expect, it } from 'vitest';

import { ORDER_ID_EXAMPLE, ORDER_ID_PATTERN, ORDER_ID_PREFIX } from './constants.js';
import { orderIdsIn, withoutOrderIds } from './order.js';
import { checkReply } from '../guardrails/output.util.js';

describe('order id format', () => {
  it('accepts 4 to 8 digits after the prefix, and nothing else', () => {
    for (const id of ['ORD-1001', 'ORD-1234', 'ORD-12345678']) expect(ORDER_ID_PATTERN.test(id), id).toBe(true);
    for (const id of ['ORD-123', 'ORD-123456789', 'ord-1001', 'ORD-10a1', ' ORD-1001', 'ORD-1001 ', '1001', '#1001']) {
      expect(ORDER_ID_PATTERN.test(id), id).toBe(false);
    }
    expect(ORDER_ID_PATTERN.test(ORDER_ID_EXAMPLE)).toBe(true);
  });

  it('is built from the prefix, so changing the prefix changes the example and the pattern together', () => {
    expect(ORDER_ID_EXAMPLE.startsWith(ORDER_ID_PREFIX)).toBe(true);
    expect(ORDER_ID_PATTERN.source.startsWith(`^${ORDER_ID_PREFIX}`)).toBe(true);
  });

  describe('finding ids in free text', () => {
    it('finds ids in any letter case and returns them in upper case', () => {
      expect(orderIdsIn('Order ORD-1001 and ord-22222, not ORD-12.')).toEqual(['ORD-1001', 'ORD-22222']);
      expect(orderIdsIn('nothing here')).toEqual([]);
    });

    it('does not match inside a longer word or number', () => {
      expect(orderIdsIn('XORD-1001')).toEqual([]);
      expect(orderIdsIn('ORD-123456789')).toEqual([]); // nine digits is not an order id, not an id plus a digit
      expect(orderIdsIn('(ORD-1001).')).toEqual(['ORD-1001']);
    });

    it('gives the same answer every time, however often it is called', () => {
      // A shared regular expression with the g flag would alternate between finding the id and missing it.
      const answers = Array.from({ length: 6 }, () => orderIdsIn('ORD-1001'));
      expect(new Set(answers.map((answer) => answer.join())).size).toBe(1);
      expect(answers[0]).toEqual(['ORD-1001']);
    });

    it('blanks ids out of text, so their digits are not read as amounts', () => {
      expect(withoutOrderIds('Regarding ORD-1001 (59.90).')).toBe('Regarding   (59.90).');
      expect(withoutOrderIds('see ord-1001')).toBe('see  ');
    });
  });

  it('is the format the reply guard uses to spot another customer’s order, in any letter case', () => {
    const context = { decision: 'info', orderIds: ['ORD-1001'], refundAmount: 0, allowedText: [] };
    expect(checkReply('Your order ORD-1001 is on its way.', context)).toEqual([]);
    expect(checkReply('Your order ord-1001 is on its way.', context)).toEqual([]);
    for (const reply of ['Another order, ORD-1002, is on its way.', 'Another order, ord-1002, is on its way.']) {
      expect(checkReply(reply, context), reply).toContainEqual(expect.stringContaining('unrelated order ORD-1002'));
    }
  });
});
