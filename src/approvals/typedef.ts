import type { ResumedReview, ReviewAnswer, ReviewRecord } from '../domain/index.js';

/** What the approvals service needs from the agent: to continue a paused run, and to forget it once recorded. */
export interface ReviewResumer {
  resume(review: Pick<ReviewRecord, 'threadId'>, answer: ReviewAnswer): Promise<ResumedReview>;
  discard(review: Pick<ReviewRecord, 'threadId'>): Promise<void>;
}
