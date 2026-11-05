import { z } from 'zod';

import { FLAG } from './constants.js';
import type { Order } from './order.js';
import type { Result } from './result.js';
import type { Classification } from './ticket.js';

/** What a human reviewer sends back. The reviewer decides yes or no; code decides the amount. */
export const reviewAnswerSchema = z.object({
  action: z.enum(['approve', 'deny']),
  reviewer: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});
export type ReviewAnswer = z.infer<typeof reviewAnswerSchema>;

/** Flags that mean the ticket cannot be acted on, whatever a reviewer says: no trustworthy order, or a hostile ticket. */
const BLOCKING_FLAGS: readonly string[] = [
  FLAG.PROMPT_INJECTION_SUSPECTED,
  FLAG.CLASSIFIER_FAILED,
  FLAG.ORDER_ID_CONFLICT,
];

export interface ReviewInput {
  decision?: string;
  lookup: string;
  order?: Order;
  classification?: Classification;
  flags: readonly string[];
}

/**
 * Whether an escalation is one a reviewer can settle here: a refund request on a verified order, with nothing
 * hostile or ambiguous about the ticket. Anything else is handed to a human outside the agent, as before.
 */
export function reviewableEscalation(input: ReviewInput): boolean {
  return (
    input.decision === 'escalate' &&
    input.lookup === 'found' &&
    input.order !== undefined &&
    !input.order.refunded &&
    input.classification?.intent === 'refund_request' &&
    !input.flags.some((flag) => BLOCKING_FLAGS.includes(flag))
  );
}

export interface ResumedReview {
  result: Result;
  /**
   * Whether this call's answer is the one the run used. False when an earlier attempt had already applied an answer
   * (money may have moved on it) and this call only carried the run to its end: `result.review` then names that answer.
   */
  consumed: boolean;
}
