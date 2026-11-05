import { interrupt } from '@langchain/langgraph';

import { reviewAnswerSchema } from '../../domain/index.js';
import { BusinessLogicError } from '../../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../../shared/errors/error-codes.js';
import { STEP } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/**
 * Pauses the run until a person answers. Nothing may happen before `interrupt()`: when the run is resumed this node
 * starts again from its first line, and `interrupt()` then returns the answer instead of pausing.
 */
export class HumanReviewNode implements AgentNode {
  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { result } = needs(state, 'result');
    const raw: unknown = interrupt({ ticketId: result.ticketId, summary: result.summary, reasons: result.reasons });

    const answer = reviewAnswerSchema.safeParse(raw);
    if (!answer.success) {
      throw new BusinessLogicError('The review answer is not valid.', ErrorCodes.INVALID_REQUEST);
    }
    const { action, reviewer, note } = answer.data;
    return {
      review: { status: action === 'approve' ? 'approved' : 'denied', reviewer, note },
      trace: step(state, { step: STEP.HUMAN_REVIEW, ok: true, detail: `${action} by ${reviewer}` }),
    };
  }
}
