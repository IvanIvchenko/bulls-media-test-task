import { describe, expect, it } from 'vitest';

import { policyConfig } from '../../test/support/fixtures.js';
import { createTestContainer } from '../../test/support/helpers.js';
import { templateReply } from '../domain/index.js';
import { checkReply } from '../guardrails/output.util.js';

/*
 * The reply writer is shown the text of the rules a decision cited and may repeat it to the customer. So rule text is
 * written as company policy, never as an instruction to the agent ("must be escalated", "must be checked by a person").
 */
const AGENT_DIRECTED = /\b(?:escalat\w*|refuse|route[ds]?|human agent|do not disclose)\b/i;

describe('policy rule text', () => {
  it('is written as policy a customer may be quoted, not as instructions to the agent', async () => {
    const { rules } = await (await createTestContainer()).policies.loadSnapshot();
    const offenders = rules.filter((rule) => AGENT_DIRECTED.test(rule.text)).map((rule) => `${rule.id}: ${rule.text}`);
    expect(offenders).toEqual([]);
  });

  it('still says who decides: a team member', async () => {
    const { rules } = await (await createTestContainer()).policies.loadSnapshot();
    const text = (id: string) => rules.find((rule) => rule.id === id)!.text;
    for (const id of ['R2', 'R3', 'R5']) expect(text(id), id).toMatch(/team member/);
  });

  it('can be quoted in a reply: each rule, repeated back by the template, passes the output guard', async () => {
    const { rules } = await (await createTestContainer()).policies.loadSnapshot();
    const facts = ['Regarding order ORD-1 (Desk Lamp).'];
    for (const rule of rules) {
      const note = `${rule.id} ${rule.title}: ${rule.text}`;
      for (const decision of ['deny', 'escalate'] as const) {
        const reply = templateReply({ decision, facts, policyNotes: [note], refundAmount: 0 });
        const context = { decision, orderIds: ['ORD-1'], refundAmount: 0, allowedText: [...facts, note] };
        expect(checkReply(reply, context), `${rule.id} in a ${decision}: ${reply}`).toEqual([]);
      }
    }
  });
});

describe('the policy numbers the pure specs use', () => {
  it('are the seeded ones, so a spec of domain code that needs no database still tests the real policy', async () => {
    const { config } = await (await createTestContainer()).policies.loadSnapshot();
    expect(config).toEqual(policyConfig);
  });
});
