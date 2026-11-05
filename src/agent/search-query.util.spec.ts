import { describe, expect, it } from 'vitest';

import { searchQuery } from './search-query.util.js';

describe('searchQuery', () => {
  it("uses the customer's words and reason words, never the intent label", () => {
    expect(searchQuery('Refund', 'It is broken', 'defective')).toContain('defective');
    expect(searchQuery('Refund', 'It is broken', 'late_delivery')).toContain('late delivery');
    expect(searchQuery('Refund', 'It is broken', 'changed_mind')).not.toContain('changed');
    expect(searchQuery('Refund', 'It is broken', null)).not.toContain('request');
  });
  it('caps the query length', () => {
    expect(searchQuery('s', 'x '.repeat(5000), null).length).toBeLessThanOrEqual(1000);
  });
});
