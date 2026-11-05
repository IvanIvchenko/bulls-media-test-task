import type { ReviewResumer } from './typedef.js';
import {
  reviewAnswerSchema,
  type Result,
  type ReviewAnswer,
  type ReviewRecord,
  type ReviewStore,
  type ReviewSummary,
  type TicketClaims,
} from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';
import { Logger } from '../shared/logger/logger.js';

/**
 * A person's yes or no on an escalation the agent paused. The database lets exactly one decision through, so two
 * reviewers (or a double click) cannot both act: the second gets a conflict, and the refund step is guarded anyway.
 * A decision whose owner dies does not block the review: after `staleAfterMs` another call takes it over, and the
 * first owner, if it comes back, can no longer record anything.
 */
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  public constructor(
    private readonly reviews: ReviewStore,
    private readonly claims: TicketClaims,
    private readonly agent: ReviewResumer,
    /** A review whose decider has not finished after this long may be taken over by another caller. */
    private readonly staleAfterMs: number,
  ) {}

  public async pending(): Promise<ReviewSummary[]> {
    return this.reviews.list();
  }

  public async get(reviewId: string): Promise<ReviewRecord> {
    const review = await this.reviews.find(reviewId);
    if (!review) throw this.notFound(reviewId);
    return review;
  }

  /**
   * Apply the answer to the paused run and replace the ticket's stored decision with the final one.
   *
   * The review is recorded with the answer the run actually applied, which is not always this one: if an earlier
   * attempt already applied someone else's answer and failed later (money may have moved on it), a retry carries on
   * with that answer. The caller is then told, even if their answer says the same, so nobody believes they decided.
   * A reviewer retrying their own answer after a failure is told nothing: it is theirs.
   */
  public async decide(reviewId: string, raw: unknown): Promise<Result> {
    const answer = reviewAnswerSchema.safeParse(raw);
    if (!answer.success) {
      throw new BusinessLogicError(
        `Invalid review answer: ${answer.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
        ErrorCodes.INVALID_REQUEST,
      );
    }

    const lease = await this.reviews.begin(reviewId, this.staleAfterMs);
    if (!lease) {
      if (await this.reviews.find(reviewId)) {
        throw new BusinessLogicError(`Review ${reviewId} is not waiting for an answer.`, ErrorCodes.REVIEW_NOT_PENDING);
      }
      throw this.notFound(reviewId);
    }

    const { review, token } = lease;
    let result: Result;
    let applied: ReviewAnswer;
    let consumed: boolean;
    try {
      ({ result, consumed } = await this.agent.resume(review, answer.data));
      applied = this.appliedAnswer(result, answer.data); // what the run says it used: the truth, not this call's input
      if (!(await this.claims.replaceResult(reviewId, result))) {
        this.logger.warn('the ticket claim is gone; the answer is recorded in the audit trail only', { reviewId });
      }
      if (!(await this.reviews.resolve(reviewId, token, applied))) {
        // Someone else took the review over while this call was still going: they will record it, not this call.
        this.logger.warn('the review was taken over before this answer could be recorded', { reviewId });
        throw new BusinessLogicError(
          `Review ${reviewId} was taken over by another reviewer before this answer was recorded.`,
          ErrorCodes.REVIEW_NOT_PENDING,
        );
      }
    } catch (error) {
      await this.reviews.release(reviewId, token); // not recorded: let it be answered again (the saved run is still there)
      throw error;
    }
    await this.forget(review);

    if (!consumed) {
      const agrees = applied.action === answer.data.action ? ', which says the same as yours' : '';
      throw new BusinessLogicError(
        `Your answer was not used: an earlier answer from ${applied.reviewer} (${applied.action}) had already been applied${agrees}.`,
        ErrorCodes.REVIEW_ALREADY_ANSWERED,
      );
    }
    return result;
  }

  /** What the run says was decided, as an answer. Falls back to the one given if the result does not say. */
  private appliedAnswer(result: Result, given: ReviewAnswer): ReviewAnswer {
    if (!result.review || result.review.status === 'pending') return given;
    return {
      action: result.review.status === 'approved' ? 'approve' : 'deny',
      reviewer: result.review.reviewer ?? given.reviewer,
      note: result.review.note,
    };
  }

  /** The answer is recorded; leftover saved state is only clutter, so a failure here is logged, not raised. */
  private async forget(review: ReviewRecord): Promise<void> {
    try {
      await this.agent.discard(review);
    } catch (error) {
      this.logger.warn('could not delete the saved run of an answered review', {
        reviewId: review.reviewId,
        err: String(error),
      });
    }
  }

  private notFound(reviewId: string): BusinessLogicError {
    return new BusinessLogicError(`Review ${reviewId} does not exist.`, ErrorCodes.REVIEW_NOT_FOUND);
  }
}
