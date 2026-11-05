import { describe, expect, it } from 'vitest';

import { rankRules, searchQuery, tokenize } from './policy-search.js';
import type { PolicyRule } from './policy.js';

// A tiny rule set built by hand: no database involved.
const rules: PolicyRule[] = [
  { id: 'A1', title: 'Return window', text: 'Physical items may be refunded within 30 days of delivery.' },
  { id: 'A2', title: 'Digital goods', text: 'Software licenses are non-refundable once delivered.' },
  { id: 'A3', title: 'Final sale', text: 'Final sale items cannot be refunded or returned.' },
  { id: 'A4', title: 'Shipping delays', text: 'A late parcel may be refunded after a week.' },
  { id: 'A5', title: 'Tracking', text: 'Customers may see the tracking status of an order.' },
];
const top = (query: string, limit?: number) => rankRules(rules, query, limit).map((hit) => hit.rule.id);

describe('tokenize', () => {
  it('lowercases, drops stopwords and short words, and trims -s / -ed / -ing', () => {
    expect(tokenize('The Items were REFUNDED, refunding refunds!')).toEqual(['item', 'refund', 'refund', 'refund']);
    expect(tokenize('the and you with')).toEqual([]);
    expect(tokenize('is it ok')).toEqual([]);
  });
});

describe('rankRules', () => {
  it('puts the rule matching the rare words first', () => {
    expect(top('my software license')[0]).toBe('A2');
    expect(top('where is my tracking status')[0]).toBe('A5');
    expect(top('the parcel is late')[0]).toBe('A4');
  });

  it('counts a title match for more than a body match', () => {
    const tied: PolicyRule[] = [
      { id: 'T1', title: 'Alpha', text: 'Mentions gamma in the body.' },
      { id: 'T2', title: 'Gamma', text: 'Mentions alpha in the body.' },
      { id: 'T3', title: 'Other', text: 'Nothing relevant.' },
      { id: 'T4', title: 'More', text: 'Nothing relevant either.' },
    ];
    expect(rankRules(tied, 'gamma', 2).map((hit) => hit.rule.id)).toEqual(['T2', 'T1']);
  });

  it('ignores words found in most rules, since they cannot tell rules apart', () => {
    expect(top('refund')).toEqual([]); // "refund" appears in 4 of 5 rules
    expect(top('refund the software license')).toEqual(['A2']);
  });

  it('returns nothing for gibberish or stopword-only queries', () => {
    expect(top('zzzz qqqq')).toEqual([]);
    expect(top('the and you with this')).toEqual([]);
    expect(top('')).toEqual([]);
  });

  it('cuts weak matches relative to the best hit and respects the limit', () => {
    const hits = rankRules(rules, 'software license delivered tracking', 5);
    for (const hit of hits) expect(hit.score).toBeGreaterThanOrEqual(hits[0]!.score * 0.5);
    expect(top('software license delivered tracking', 1)).toHaveLength(1);
  });

  it('is deterministic and breaks ties by rule id', () => {
    const twins: PolicyRule[] = [
      { id: 'B2', title: 'Twin', text: 'identical zebra text' },
      { id: 'B1', title: 'Twin', text: 'identical zebra text' },
      { id: 'B3', title: 'Other', text: 'unrelated one' },
      { id: 'B4', title: 'Other', text: 'unrelated two' },
    ];
    expect(rankRules(twins, 'zebra').map((hit) => hit.rule.id)).toEqual(['B1', 'B2']);
    expect(top('late parcel')).toEqual(top('late parcel'));
  });

  it('does not filter generic words when the rule set is too small to judge', () => {
    const few = rules.slice(0, 3);
    expect(rankRules(few, 'refunded').length).toBeGreaterThan(0);
  });
});

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
