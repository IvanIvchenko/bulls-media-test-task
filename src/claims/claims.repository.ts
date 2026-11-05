import { randomUUID } from 'node:crypto';

import type { ClaimRow } from './typedef.js';
import { TABLE } from '../db/constants.js';
import type { Database } from '../db/typedef.js';

const IN_PROGRESS = 'in_progress';

/**
 * Every method is one atomic statement, so the database decides who wins no matter how many processes race. Claim
 * times are stamped by the database (`now()`), never by the instance, so clock skew between hosts cannot make a
 * live claim look stale.
 */
export class ClaimsRepository {
  public constructor(private readonly database: Database) {}

  /** `ON CONFLICT DO NOTHING` on the primary key: of any number of racing callers, exactly one inserts. */
  public async insertIfAbsent(ticketId: string, requestHash: string): Promise<string | undefined> {
    const ownerToken = randomUUID();
    const inserted = await this.database(TABLE.TICKET_CLAIMS)
      .insert({
        ticket_id: ticketId,
        request_hash: requestHash,
        status: IN_PROGRESS,
        owner_token: ownerToken,
        claimed_at: this.database.fn.now(),
      })
      .onConflict('ticket_id')
      .ignore()
      .returning('ticket_id'); // empty when the id was already taken
    return inserted.length > 0 ? ownerToken : undefined;
  }

  public async findById(ticketId: string): Promise<ClaimRow | undefined> {
    return this.database<ClaimRow>(TABLE.TICKET_CLAIMS)
      .where({ ticket_id: ticketId })
      .first('*', this.database.raw('CURRENT_TIMESTAMP as db_now'));
  }

  /** Compare-and-set on the old owner's token: only one of several would-be successors can match it. */
  public async replaceOwner(ticketId: string, expiredToken: string): Promise<string | undefined> {
    const ownerToken = randomUUID();
    const updated = await this.database(TABLE.TICKET_CLAIMS)
      .where({ ticket_id: ticketId, owner_token: expiredToken, status: IN_PROGRESS })
      .update({ owner_token: ownerToken, claimed_at: this.database.fn.now() });
    return updated === 1 ? ownerToken : undefined;
  }

  public async markDone(ticketId: string, ownerToken: string, resultJson: string): Promise<boolean> {
    const updated = await this.database(TABLE.TICKET_CLAIMS)
      .where({ ticket_id: ticketId, owner_token: ownerToken, status: IN_PROGRESS })
      .update({ status: 'done', result_json: resultJson, claimed_at: this.database.fn.now() });
    return updated === 1;
  }

  public async deleteInProgress(ticketId: string, ownerToken: string): Promise<void> {
    await this.database(TABLE.TICKET_CLAIMS)
      .where({ ticket_id: ticketId, owner_token: ownerToken, status: IN_PROGRESS })
      .del();
  }
}
