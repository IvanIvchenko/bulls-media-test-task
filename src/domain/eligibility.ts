import type { Order } from './order.js';
import { RULE, type PolicyConfig } from './policy.js';
import type { Classification } from './ticket.js';

export interface Eligibility {
  verdict: 'approve' | 'deny' | 'escalate';
  reasons: string[];
  citations: string[];
}

const DAY = 86_400_000;

function daysSince(dateIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateIso).getTime()) / DAY);
}

/**
 * Tool: checkRefundEligibility. PURE and deterministic: this, not the LLM, decides money.
 * Windows, the approval limit and category rules come from the database (`policy`); rule ids cited
 * in the result come from the same rows. The LLM only supplies `refundReason`, which can at most pick
 * the defect window, and even then only to send the ticket to a human: the model's reading of the customer's words
 * can make the outcome stricter, never more lenient. It never overrides category, already-refunded or amount-limit rules.
 */
export function checkRefundEligibility(
  order: Order,
  reason: Classification['refundReason'],
  now: Date,
  policy: PolicyConfig,
): Eligibility {
  if (order.refunded) {
    return { verdict: 'deny', reasons: ['Order was already refunded.'], citations: [RULE.ALREADY_REFUNDED] };
  }
  const categoryRule = policy.categoryRules[order.category];
  if (categoryRule) {
    return { verdict: categoryRule.verdict, reasons: [categoryRule.reason], citations: [categoryRule.ruleId] };
  }
  if (order.status !== 'delivered' || !order.deliveredAt) {
    return {
      verdict: 'deny',
      reasons: [`Order is not delivered yet (status: ${order.status}).`],
      citations: [policy.returnWindow.ruleId],
    };
  }

  const age = daysSince(order.deliveredAt, now);
  if (age < 0) {
    // Not the customer's doing and not something to approve or deny on: the order data needs a human.
    return {
      verdict: 'escalate',
      reasons: ['The recorded delivery date is in the future, so the order data needs a human check.'],
      citations: [],
    };
  }
  const claimsDefect = reason === 'defective' || reason === 'not_as_described';
  if (age > policy.returnWindow.days) {
    if (!claimsDefect || age > policy.defectWindow.days) {
      const window = claimsDefect ? policy.defectWindow : policy.returnWindow;
      return {
        verdict: 'deny',
        reasons: [
          `Delivered ${age} days ago; the ${claimsDefect ? 'defect' : 'return'} window is ${window.days} days.`,
        ],
        citations: [window.ruleId],
      };
    }
    // A defect claim is only words in a message, and one word would otherwise buy the longer window. A person checks it.
    return {
      verdict: 'escalate',
      reasons: [
        `Delivered ${age} days ago, past the ${policy.returnWindow.days}-day return window. The customer reports a defect ` +
          `(window ${policy.defectWindow.days} days), which a team member must verify.`,
      ],
      citations: [policy.defectWindow.ruleId, policy.returnWindow.ruleId],
    };
  }
  if (order.amount > policy.autoApproveLimit.amount) {
    return {
      verdict: 'escalate',
      reasons: [
        `Amount ${order.amount.toFixed(2)} exceeds auto-approval limit ${policy.autoApproveLimit.amount.toFixed(2)}.`,
      ],
      citations: [policy.autoApproveLimit.ruleId],
    };
  }
  return {
    verdict: 'approve',
    reasons: [
      `Within ${policy.returnWindow.days}-day window (delivered ${age} days ago) and under auto-approval limit.`,
    ],
    citations: [policy.returnWindow.ruleId, policy.autoApproveLimit.ruleId],
  };
}
