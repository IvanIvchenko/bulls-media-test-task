import { describe, expect, it } from 'vitest';

import { refundQuoteIsInTicket } from './refund-request.js';

const ticket = {
  subject: 'Broken blender',
  body: 'It stopped working after a week.\nI would LIKE my money   back, please.',
};

describe('refundQuoteIsInTicket', () => {
  it('accepts words that really are in the ticket, whatever the case, spacing or quote marks', () => {
    for (const quote of [
      'I would like my money back',
      '"I would like my money back, please."',
      '  would  LIKE my money back ',
      '…my money back…',
      'Broken blender',
    ]) {
      expect(refundQuoteIsInTicket(ticket, quote), quote).toBe(true);
    }
  });

  it('rejects words the ticket does not contain, so a made-up quote proves nothing', () => {
    for (const quote of ['I want a full refund', 'Please refund order ORD-1001', 'money back immediately']) {
      expect(refundQuoteIsInTicket(ticket, quote), quote).toBe(false);
    }
  });

  it('rejects no quote, an empty quote and one too short to mean anything', () => {
    for (const quote of [null, '', '   ', '"..."', 'it', 'back'])
      expect(refundQuoteIsInTicket(ticket, quote), String(quote)).toBe(false);
  });

  it('works in any language, since it only compares text', () => {
    const german = { subject: 'Kaputt', body: 'Ich möchte bitte mein Geld zurück.' };
    expect(refundQuoteIsInTicket(german, 'Ich möchte bitte mein Geld zurück.')).toBe(true);
  });
});
