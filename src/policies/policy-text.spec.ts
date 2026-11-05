import { describe, expect, it } from 'vitest';

import { createTestContainer } from '../../test/support/helpers.js';

/*
 * The reply writer is shown the text of the rules a decision cited and may repeat it to the customer. So rule text is
 * written as company policy. It must never be an instruction to the agent: real replies repeated "must be escalated"
 * and "the claim must be checked by a person".
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
});
