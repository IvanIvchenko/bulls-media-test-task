import type { RetentionRepository } from './retention.repository.js';

export interface PruneResult {
  decisions: number;
  claims: number;
  reviews: number;
}

const DAY_MS = 86_400_000;

/**
 * Deletes data past its retention period so the audit trail and the idempotency record do not grow without end
 * and do not keep customer-facing text for ever. Refunds are financial records and are never deleted here.
 */
export class RetentionService {
  public constructor(
    private readonly repository: RetentionRepository,
    private readonly now: () => Date,
  ) {}

  /** Delete audit rows, finished claims and answered reviews older than `days` days. Safe to run repeatedly, e.g. from cron. */
  public async prune(days: number): Promise<PruneResult> {
    if (!Number.isFinite(days) || days <= 0) throw new RangeError('days must be a positive number');
    const cutoff = new Date(this.now().getTime() - days * DAY_MS);
    return {
      decisions: await this.repository.deleteDecisionsBefore(cutoff),
      claims: await this.repository.deleteDoneClaimsBefore(cutoff),
      reviews: await this.repository.deleteResolvedReviewsBefore(cutoff),
    };
  }
}
