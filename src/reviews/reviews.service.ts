import type { ReviewsMapper } from './reviews.mapper.js';
import type { ReviewsRepository } from './reviews.repository.js';
import type {
  NewReview,
  ReviewAnswer,
  ReviewLease,
  ReviewRecord,
  ReviewStore,
  ReviewSummary,
  ReviewToken,
} from '../domain/index.js';

/** Runs paused for a human, shared by every instance that uses the same database. */
export class ReviewsService implements ReviewStore {
  public constructor(
    private readonly repository: ReviewsRepository,
    private readonly mapper: ReviewsMapper,
  ) {}

  public async open(review: NewReview): Promise<void> {
    await this.repository.insertPending(review);
  }

  public async list(): Promise<ReviewSummary[]> {
    return (await this.repository.listPending()).map((row) => this.mapper.toSummary(row));
  }

  public async find(reviewId: string): Promise<ReviewRecord | undefined> {
    const row = await this.repository.findById(reviewId);
    return row ? this.mapper.toRecord(row) : undefined;
  }

  public async begin(reviewId: string, staleAfterMs: number): Promise<ReviewLease | undefined> {
    const lease = await this.repository.begin(reviewId, staleAfterMs);
    return lease ? { review: this.mapper.toRecord(lease.row), token: lease.token } : undefined;
  }

  public async release(reviewId: string, token: ReviewToken): Promise<void> {
    await this.repository.release(reviewId, token);
  }

  public async resolve(reviewId: string, token: ReviewToken, answer: ReviewAnswer): Promise<boolean> {
    return this.repository.resolve(reviewId, token, answer);
  }
}
