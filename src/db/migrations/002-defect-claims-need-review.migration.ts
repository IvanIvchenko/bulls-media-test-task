import type { Database, Migration, Transaction } from '../typedef.js';

const OLD_TEXT =
  'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery.';
const NEW_TEXT =
  'Items that arrive defective or not as described may be refunded within {{defect_window_days}} days of delivery. ' +
  'After {{return_window_days}} days the claim cannot be checked automatically: escalate it to a human.';

/**
 * A defect claim after the standard return window now goes to a human instead of being approved. The behaviour is in
 * the code; this brings the stored rule text in line, unless someone has already edited that rule.
 */
export const defectClaimsNeedReview: Migration = {
  name: '002-defect-claims-need-review',

  async up(database: Database | Transaction): Promise<void> {
    await database('policy_rules').where({ id: 'R2', text: OLD_TEXT }).update({ text: NEW_TEXT });
  },
};
