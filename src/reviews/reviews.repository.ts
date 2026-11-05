import type { ReviewRow } from './typedef.js';
import { TABLE } from '../db/constants.js';
import type { Database } from '../db/typedef.js';
import type { NewReview, Result, ReviewAnswer } from '../domain/index.js';

/** More than a few earlier denials add nothing a reviewer can use. */
const MAX_PRIOR_DENIALS = 5;

/** Every state change is one conditional statement, so the database decides who wins when two answers race. */
export class ReviewsRepository {
  public constructor(private readonly database: Database) {}

  /**
   * Replaces a waiting row with the same id (the ticket was sent again while it waited) and an answered one (it came
   * back after being decided: a new escalation). A review someone is deciding right now is not touched: the insert
   * then fails on the key, which is loud, not a lost review. Returns the thread of the waiting row it replaced.
   */
  public async insertPending(review: NewReview): Promise<string | undefined> {
    return this.database.transaction(async (trx) => {
      const replaced = await trx<ReviewRow>(TABLE.PENDING_REVIEWS)
        .where({ review_id: review.reviewId, status: 'pending' })
        .first('thread_id');
      await trx(TABLE.PENDING_REVIEWS)
        .where({ review_id: review.reviewId })
        .whereIn('status', ['pending', 'resolved'])
        .del();
      await trx(TABLE.PENDING_REVIEWS).insert({
        review_id: review.reviewId,
        ticket_id: review.ticketId,
        order_id: review.orderId,
        thread_id: review.threadId,
        status: 'pending',
        request_json: JSON.stringify(review.request),
      });
      return replaced?.thread_id;
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

  /** Answered reviews of this order that said no, other than `exceptReviewId`, newest first. */
  public async deniedFor(orderId: string, exceptReviewId: string): Promise<ReviewRow[]> {
    return this.database<ReviewRow>(TABLE.PENDING_REVIEWS)
      .where({ order_id: orderId, status: 'resolved', decision: 'deny' })
      .whereNot({ review_id: exceptReviewId })
      .orderBy('resolved_at', 'desc')
      .limit(MAX_PRIOR_DENIALS)
      .select('ticket_id', 'reviewer', 'note', 'resolved_at');
  }

  /** The caller whose update changes a row is the only one that gets it back. */
  public async begin(reviewId: string): Promise<ReviewRow | undefined> {
    const updated = await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'pending' })
      .update({ status: 'deciding' });
    return updated === 1 ? this.findById(reviewId) : undefined;
  }

  public async release(reviewId: string): Promise<void> {
    await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'deciding' })
      .update({ status: 'pending' });
  }

  public async resolve(reviewId: string, answer: ReviewAnswer, result: Result): Promise<void> {
    await this.database(TABLE.PENDING_REVIEWS)
      .where({ review_id: reviewId, status: 'deciding' })
      .update({
        status: 'resolved',
        resolved_at: this.database.fn.now(),
        final_json: JSON.stringify(result),
        decision: answer.action,
        reviewer: answer.reviewer,
        note: answer.note ?? null,
      });
  }

  public async recover(): Promise<number> {
    return this.database(TABLE.PENDING_REVIEWS).where({ status: 'deciding' }).update({ status: 'pending' });
  }
}
