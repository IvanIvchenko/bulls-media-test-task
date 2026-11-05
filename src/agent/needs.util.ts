import type { AgentState } from './typedef.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

/** The state with these fields known to be present. */
export type WithFields<K extends keyof AgentState> = AgentState & { [P in K]-?: NonNullable<AgentState[P]> };

/**
 * A node's declaration of what earlier steps must have produced. Returns the state typed accordingly, or throws a
 * clear error if the graph ran the node out of order. Replaces `state.ticket!`, which would fail later and vaguer.
 */
export function needs<K extends keyof AgentState>(state: AgentState, ...fields: K[]): WithFields<K> {
  const missing = fields.filter((field) => state[field] === undefined || state[field] === null);
  if (missing.length > 0) {
    throw new BusinessLogicError(
      `Agent step ran before its inputs existed (missing: ${missing.join(', ')}). The graph order is broken.`,
      ErrorCodes.AGENT_STATE_INVARIANT,
    );
  }
  return state as WithFields<K>;
}
