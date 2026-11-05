import { pickRules } from '../../domain/index.js';
import { QUOTABLE_DECISIONS, STEP, TOOL } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/**
 * Tool call: getPolicyRules (from the loaded snapshot). Takes the text of the rules the decision cited, so the
 * reply can explain the decision in the company's own words. Only for verified orders: nothing is quoted to an
 * unverified requester.
 */
export class CitePoliciesNode implements AgentNode {
  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { policies } = needs(state, 'policies');
    const quotable =
      state.lookup === 'found' &&
      state.decision !== undefined &&
      QUOTABLE_DECISIONS.has(state.decision) &&
      state.citations.length > 0;
    if (!quotable) {
      return { trace: step(state, { step: STEP.CITE_POLICIES, ok: true, detail: 'nothing to cite' }) };
    }

    const ids = [...new Set(state.citations)];
    const rules = pickRules(policies.rules, ids);
    return {
      policyNotes: rules.map((rule) => `${rule.id} ${rule.title}: ${rule.text}`),
      trace: step(state, {
        step: STEP.CITE_POLICIES,
        tool: TOOL.GET_POLICY_RULES,
        ok: rules.length === ids.length,
        detail: `cited: ${rules.map((rule) => rule.id).join(',') || 'none'}`,
      }),
    };
  }
}
