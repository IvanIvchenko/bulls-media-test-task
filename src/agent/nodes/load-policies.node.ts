import type { PolicyTools } from '../../domain/index.js';
import { STEP, TOOL } from '../constants.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/**
 * Tool call: loadPolicySnapshot. Reads the policy once, so the rest of the run (search, eligibility, citations,
 * reviewer handoff) works from memory. Only runs for valid tickets: invalid input never touches the database.
 */
export class LoadPoliciesNode implements AgentNode {
  public constructor(private readonly policies: PolicyTools) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const snapshot = await this.policies.loadSnapshot();
    return {
      policies: snapshot,
      trace: step(state, {
        step: STEP.LOAD_POLICIES,
        tool: TOOL.LOAD_POLICY_SNAPSHOT,
        ok: true,
        detail: `${snapshot.rules.length} rules`,
      }),
    };
  }
}
