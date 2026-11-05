import type { PolicyConfig } from '../../src/domain/index.js';

/** The fixed clock the tests run on. */
export const NOW = new Date('2026-11-04');

/**
 * The seeded policy numbers, written out, so specs of pure domain code need no database. A spec in `src/policies`
 * checks this against the seed, so the two cannot drift apart.
 */
export const policyConfig: PolicyConfig = {
  returnWindow: { days: 30, ruleId: 'R1' },
  defectWindow: { days: 60, ruleId: 'R2' },
  autoApproveLimit: { amount: 100, ruleId: 'R5' },
  categoryRules: {
    digital: {
      verdict: 'escalate',
      ruleId: 'R3',
      reason: 'Digital goods are non-refundable; a human must check legal exceptions.',
    },
    final_sale: { verdict: 'deny', ruleId: 'R4', reason: 'Final sale items cannot be refunded.' },
  },
};
