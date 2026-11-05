import { FLAG } from '../../domain/index.js';
import { validateTicket } from '../../guardrails/input.util.js';
import { STEP } from '../constants.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** Validate the raw (untrusted) input. Invalid input short-circuits to a refusal. */
export class ValidateNode implements AgentNode {
  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const validation = validateTicket(state.raw);
    if (validation.ok) {
      return {
        ticket: validation.ticket,
        trace: step(state, { step: STEP.VALIDATE, ok: true, detail: 'input valid' }),
      };
    }
    return {
      decision: 'refuse',
      reasons: ['Invalid ticket input.', ...validation.errors],
      flags: [FLAG.INVALID_INPUT],
      trace: step(state, { step: STEP.VALIDATE, ok: false, detail: validation.errors.join('; ') }),
    };
  }
}
