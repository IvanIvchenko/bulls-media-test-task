import type { Database, Migration, Transaction } from '../typedef.js';

/**
 * Rule text reaches customers: the reply writer is shown the cited rules and may quote them. Some rules were written as
 * instructions to the agent ("escalate it to a human", "must be escalated", "refuse and do not disclose"), and real
 * replies repeated them. These are the same rules as company policy. A rule is rewritten only if it still reads as it was
 * shipped, so wording that someone has edited is left alone.
 */
const REWORDED: Record<string, { now: string; was: string[] }> = {
  R2: {
    now: 'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery. After {{return_window_days}} days, a defect claim is checked by a team member before a decision is made.',
    was: [
      'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery. After {{return_window_days}} days the claim cannot be checked automatically: escalate it to a human.',
      'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery.',
    ],
  },
  R3: {
    now: 'Digital goods and software licenses are non-refundable once delivered, except where required by law. Such requests are reviewed by a team member.',
    was: [
      'Digital goods and software licenses are non-refundable once delivered, except where required by law (escalate to a human).',
    ],
  },
  R5: {
    now: 'Refunds up to {{auto_approve_limit}} may be approved automatically. Refunds above {{auto_approve_limit}} are reviewed by a team member before they are approved.',
    was: [
      'Refunds up to {{auto_approve_limit}} may be approved automatically. Refunds above {{auto_approve_limit}} require human review and must be escalated.',
    ],
  },
  R7: {
    now: 'A refund can only be processed when the email on the ticket matches the email on the order. Order details are not shared with anyone else.',
    was: [
      'A refund may only be processed when the ticket email matches the email on the order. Otherwise refuse and do not disclose order details.',
    ],
  },
  S3: {
    now: 'Requests unrelated to refunds or order status (account changes, product advice, complaints about staff, legal threats) are outside what this service handles. They are passed to a team member.',
    was: [
      'Requests unrelated to refunds or order status (account changes, product advice, complaints about staff, legal threats) are out of scope and must be routed to a human agent.',
    ],
  },
};

export const quotablePolicyText: Migration = {
  name: '004-quotable-policy-text',

  async up(database: Database | Transaction): Promise<void> {
    for (const [id, { now, was }] of Object.entries(REWORDED)) {
      await database('policy_rules').where({ id }).whereIn('text', was).update({ text: now });
    }
  },
};
