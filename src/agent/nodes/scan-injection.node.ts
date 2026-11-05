import { FLAG } from '../../domain/index.js';
import { detectInjection } from '../../guardrails/injection.util.js';
import { STEP } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** Heuristic prompt-injection scan. Only flags; `decide` turns the flag into an escalation. */
export class ScanInjectionNode implements AgentNode {
  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { ticket } = needs(state, 'ticket');
    const matches = detectInjection(`${ticket.subject}\n${ticket.body}`);
    return {
      flags: matches.length ? [FLAG.PROMPT_INJECTION_SUSPECTED] : [],
      trace: step(state, {
        step: STEP.SCAN_INJECTION,
        ok: matches.length === 0,
        detail: matches.length ? `matched ${matches.length} pattern(s)` : 'clean',
      }),
    };
  }
}
