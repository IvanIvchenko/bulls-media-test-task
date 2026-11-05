import type { Result } from './result.js';
import type { Ticket } from './ticket.js';

/** Everything needed to write a customer reply. The decision and the facts are already settled by code. */
export interface ReplyContext {
  ticket: Ticket;
  decision: Result['decision'];
  /** Facts the reply may use. The LLM only words them. */
  facts: string[];
  /** Text of the policy rules the decision cited (trusted, from the database). May be quoted, not extended. */
  policyNotes: string[];
  refundAmount: number;
}

/** What the template needs: everything the model is given except the customer's own words, which it never uses. */
export type TemplateContext = Omit<ReplyContext, 'ticket'>;

/**
 * Deterministic reply. It is the offline reply of the mock model and, in production, the safe fallback
 * when the real model fails or its draft is rejected by the output guard. It must always pass that guard.
 */
export function templateReply(ctx: TemplateContext): string {
  const hi = 'Hello,';
  const facts = ctx.facts.join(' ');
  const policy = ctx.policyNotes.length ? ` Relevant policy: ${ctx.policyNotes.join(' ')}` : '';
  switch (ctx.decision) {
    case 'approve':
      return `${hi} your refund of ${ctx.refundAmount.toFixed(2)} has been approved. ${facts} Thank you for your patience.`;
    case 'deny':
      return `${hi} unfortunately we cannot refund this order. ${facts}${policy} If you believe this is a mistake, reply and a team member will take another look.`;
    case 'escalate':
      return `${hi} thank you for contacting us. ${facts}`;
    case 'refuse':
      return `${hi} we could not verify this request against your account, so we are unable to help with it here. Please contact support from the email used for the order.`;
    case 'info':
      return `${hi} thank you for getting in touch. ${facts}`;
  }
}
