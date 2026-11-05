import type { ReviewsMapper } from './reviews.mapper.js';
import type { ReviewsRepository } from './reviews.repository.js';
import { fromStoredTimestamp } from '../db/timestamps.util.js';
import type {
  NewReview,
  PriorDenial,
  Result,
  ReviewAnswer,
  ReviewRecord,
  ReviewStore,
  ReviewSummary,
} from '../domain/index.js';

/** Runs paused for a human. */
export class ReviewsService implements ReviewStore {
  public constructor(
    private readonly repository: ReviewsRepository,
    private readonly mapper: ReviewsMapper,
  ) {}

  public async open(review: NewReview): Promise<string | undefined> {
    return this.repository.insertPending(review);
  }

  public async list(): Promise<ReviewSummary[]> {
    return (await this.repository.listPending()).map((row) => this.mapper.toSummary(row));
  }

  public async find(reviewId: string): Promise<ReviewRecord | undefined> {
    const row = await this.repository.findById(reviewId);
    return row ? this.mapper.toRecord(row) : undefined;
  }

  public async deniedFor(orderId: string, exceptReviewId: string): Promise<PriorDenial[]> {
    return (await this.repository.deniedFor(orderId, exceptReviewId)).map((row) => ({
      ticketId: row.ticket_id,
      reviewer: row.reviewer ?? 'unknown',
      note: row.note ?? undefined,
      decidedAt: fromStoredTimestamp(row.resolved_at ?? new Date(0)),
    }));
  }

  public async begin(reviewId: string): Promise<ReviewRecord | undefined> {
    const row = await this.repository.begin(reviewId);
    return row ? this.mapper.toRecord(row) : undefined;
  }

  public async release(reviewId: string): Promise<void> {
    await this.repository.release(reviewId);
  }

  public async resolve(reviewId: string, answer: ReviewAnswer, result: Result): Promise<void> {
    await this.repository.resolve(reviewId, answer, result);
  }

  public async recover(): Promise<number> {
    return this.repository.recover();
  }
}
