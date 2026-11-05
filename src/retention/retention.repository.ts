import { TABLE } from '../db/constants.js';
import { toStoredTimestamp } from '../db/timestamps.util.js';
import type { Database } from '../db/typedef.js';

export class RetentionRepository {
  public constructor(private readonly database: Database) {}

  /** Audit rows written before the cutoff. Timestamps are stored as ISO strings, which sort in time order. */
  public async deleteDecisionsBefore(cutoff: Date): Promise<number> {
    return this.database(TABLE.DECISIONS).where('created_at', '<', cutoff.toISOString()).del();
  }

  /**
   * Finished claims last touched before the cutoff. A claim still `in_progress` is never touched here: whether its
   * owner is dead is for the staleness rule, at the moment someone needs the ticket.
   */
  public async deleteDoneClaimsBefore(cutoff: Date): Promise<number> {
    return this.database(TABLE.TICKET_CLAIMS)
      .where({ status: 'done' })
      .andWhere('claimed_at', '<', toStoredTimestamp(this.database, cutoff))
      .del();
  }
}
