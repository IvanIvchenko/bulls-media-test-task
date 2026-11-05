import { randomUUID } from 'node:crypto';

import type { ReviewRow } from './typedef.js';
import { TABLE } from '../db/constants.js';
import { fromStoredTimestamp } from '../db/timestamps.util.js';
import type { Database } from '../db/typedef.js';
import type { NewReview, ReviewAnswer } from '../domain/index.js';

/**
 * Every state change is one conditional statement, so the database decides who wins however many instances race.
 * Deciding times are stamped by the database (`now()`), never by the instance, so clock skew between hosts cannot
 * make a live decision look stale.
 */
export class ReviewsRepository {
  public constructor(private readonly database: Database) {}

  /**
   * Replaces a pending row with the same id (the run was repeated after a crash, so its saved state is newer) and a
   * resolved one (the same ticket id came back after its old claim was pruned, which is a new escalation). A review
   * someone is deciding right now is not touched: the insert then fails on the key, which is loud, not a lost review.
   */
  public async insertPending(review: NewReview): Promise<void> {
    await this.database.transaction(async (trx) => {
      await trx(TABLE.PENDING_REVIEWS)
        .where({ review_id: review.reviewId })
        .whereIn('status', ['pending', 'resolved'])
        .del();
      await trx(TABLE.PENDING_REVIEWS).insert({
        review_id: review.reviewId,
        ticket_id: review.ticketId,
        thread_id: review.threadId,
        status: 'pending',
        request_json: JSON.stringify(review.request),
      });
    });
  }

  public async listPending(): Promise<ReviewRow[]> {
    return this.database<ReviewRow>(TABLE.PENDING_REVIEWS)
      .where({ status: 'pending' })
      .orderBy('created_at', 'asc')
      .select('review_id', 'ticket_id', 'created_at', 'request_json');
  }

  public async findById(reviewId: string): Promise<ReviewRow | undefined> {
    return this.database<ReviewRow>(TABLE.PENDING_REVIEWS).where({ review_id: reviewId }).first();
  }

  /**
   * The caller whose update changes a row gets it back with a fresh token. A review being decided is taken over only
   * when its decider has been at it longer than `staleAfterMs`, and only by the one caller whose update still matches
   * the old token, so the previous decider can no longer record anything.
   */
  public async begin(reviewId: string, staleAfterMs: number): Promise<{ row: ReviewRow; token: string } | undefined> {
    const token = randomUUID();
    const started = await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'pending' })
      .update({ status: 'deciding', decider_token: token, deciding_since: this.database.fn.now() });
    if (started === 1) return this.leased(reviewId, token);

    const current = await this.findWithClock(reviewId);
    if (!current || current.status !== 'deciding' || !current.deciding_since || !current.db_now) return undefined;
    const ageMs = fromStoredTimestamp(current.db_now).getTime() - fromStoredTimestamp(current.deciding_since).getTime();
    if (ageMs <= staleAfterMs) return undefined;

    const takenOver = await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'deciding', decider_token: current.decider_token })
      .update({ decider_token: token, deciding_since: this.database.fn.now() });
    return takenOver === 1 ? this.leased(reviewId, token) : undefined;
  }

  public async release(reviewId: string, token: string): Promise<void> {
    await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'deciding', decider_token: token })
      .update({ status: 'pending', decider_token: null, deciding_since: null });
  }

  public async resolve(reviewId: string, token: string, answer: ReviewAnswer): Promise<boolean> {
    const updated = await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'deciding', decider_token: token })
      .update({
        status: 'resolved',
        decider_token: null,
        deciding_since: null,
        resolved_at: this.database.fn.now(),
        decision: answer.action,
        reviewer: answer.reviewer,
        note: answer.note ?? null,
      });
    return updated === 1;
  }

  private async leased(reviewId: string, token: string): Promise<{ row: ReviewRow; token: string } | undefined> {
    const row = await this.findById(reviewId);
    return row ? { row, token } : undefined;
  }

  private async findWithClock(reviewId: string): Promise<ReviewRow | undefined> {
    return this.database<ReviewRow>(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId })
      .first('*', this.database.raw('CURRENT_TIMESTAMP as db_now'));
  }
}
