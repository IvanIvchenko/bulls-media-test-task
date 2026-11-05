import { checkRefundEligibility } from '../../domain/index.js';
import { STEP, TOOL } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** Deterministic refund-eligibility tool, run against the policy snapshot loaded for this ticket. */
export class CheckEligibilityNode implements AgentNode {
  public constructor(private readonly now: () => Date) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { order, classification, policies } = needs(state, 'order', 'classification', 'policies');
    const eligibility = checkRefundEligibility(order, classification.refundReason, this.now(), policies.config);
    return {
      eligibility,
      trace: step(state, {
        step: STEP.CHECK_ELIGIBILITY,
        tool: TOOL.CHECK_REFUND_ELIGIBILITY,
        ok: true,
        detail: `${eligibility.verdict}: ${eligibility.reasons.join(' ')}`,
      }),
    };
  }
}
