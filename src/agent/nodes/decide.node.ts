import { decideOutcome } from '../../domain/index.js';
import { STEP } from '../constants.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** Graph node around the pure decision policy in `domain/decision.ts`. */
export class DecideNode implements AgentNode {
  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const outcome = decideOutcome(state);
    return {
      decision: outcome.decision,
      reasons: outcome.reasons,
      facts: outcome.facts,
      citations: outcome.citations,
      refundAmount: outcome.refundAmount,
      trace: step(state, { step: STEP.DECIDE, ok: true, detail: `${outcome.decision}: ${outcome.reasons.join(' ')}` }),
    };
  }
}
