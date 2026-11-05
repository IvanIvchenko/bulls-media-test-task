import { describe, expect, it } from 'vitest';

import { roundMoney } from './money.js';

describe('roundMoney', () => {
  it('keeps whole cents and drops float noise', () => {
    expect(roundMoney(59.9)).toBe(59.9);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(59.900000000000006)).toBe(59.9);
  });

  it('rounds half a cent up, and handles zero', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0)).toBe(0);
  });
});
