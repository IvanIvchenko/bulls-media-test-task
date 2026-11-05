import { describe, expect, it } from 'vitest';

import { snapshot, stateWith } from '../../../test/support/nodes.js';
import type { AgentState } from '../typedef.js';
import { CitePoliciesNode } from './cite-policies.node.js';

describe('CitePoliciesNode', () => {
  const cited = (patch: Partial<AgentState>) =>
    new CitePoliciesNode().execute(
      stateWith({ policies: snapshot, lookup: 'found', citations: ['R1', 'R5'], ...patch }),
    );

  it('quotes the cited rules, with their current text, for a decision that can explain itself', async () => {
    for (const decision of ['approve', 'deny', 'escalate'] as const) {
      const update = await cited({ decision });
      expect(update.policyNotes, decision).toHaveLength(2);
      expect(update.policyNotes?.[0]).toMatch(/^R1 Return window: Physical items may be refunded within 30 days/);
    }
  });

  it('quotes nothing for a refusal or an information reply', async () => {
    for (const decision of ['refuse', 'info'] as const) {
      expect((await cited({ decision })).policyNotes, decision).toBeUndefined();
    }
  });

  it('quotes nothing when the order was not verified for this sender', async () => {
    for (const lookup of ['not_found', 'email_mismatch', 'no_order_id'] as const) {
      expect((await cited({ decision: 'deny', lookup })).policyNotes, lookup).toBeUndefined();
    }
  });

  it('quotes nothing when the decision cited nothing', async () => {
    expect((await cited({ decision: 'deny', citations: [] })).policyNotes).toBeUndefined();
  });

  it('flags in the trace if a cited rule is missing from the policy', async () => {
    const update = await cited({ decision: 'deny', citations: ['R1', 'GONE'] });
    expect(update.trace?.[0]).toMatchObject({ ok: false, detail: 'cited: R1' });
  });
});
