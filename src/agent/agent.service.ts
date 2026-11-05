import { randomUUID } from 'node:crypto';

import { Command } from '@langchain/langgraph';

import { buildGraph, buildReviewGraph } from './agent.graph.js';
import { STEP } from './constants.js';
import { ApplyReviewNode } from './nodes/apply-review.node.js';
import { CheckEligibilityNode } from './nodes/check-eligibility.node.js';
import { CitePoliciesNode } from './nodes/cite-policies.node.js';
import { ClassifyNode } from './nodes/classify.node.js';
import { DecideNode } from './nodes/decide.node.js';
import { DraftReplyNode } from './nodes/draft-reply.node.js';
import { ExecuteRefundNode } from './nodes/execute-refund.node.js';
import { FinalizeNode } from './nodes/finalize.node.js';
import { GatherNode } from './nodes/gather.node.js';
import { HumanReviewNode } from './nodes/human-review.node.js';
import { LoadPoliciesNode } from './nodes/load-policies.node.js';
import { ScanInjectionNode } from './nodes/scan-injection.node.js';
import { ValidateNode } from './nodes/validate.node.js';
import type { AgentState, AgentDeps, RunOptions } from './typedef.js';
import {
  reviewableEscalation,
  type Result,
  type ResumedReview,
  type ReviewAnswer,
  type ReviewRecord,
} from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

type ThreadConfig = { configurable: { thread_id: string } };

/**
 * The triage agent: compiles the graphs once, then runs them for one raw (untrusted) ticket at a time.
 *
 * Most tickets run the workflow graph start to finish and write nothing extra. An escalation a reviewer can settle
 * then continues in a second, tiny graph that pauses for a person. That graph is the only one with a checkpointer,
 * so only paused runs are saved (in the database, by `KnexCheckpointSaver`), and any instance can resume them.
 */
export class AgentService {
  private readonly graph: ReturnType<typeof buildGraph>;
  private readonly reviewGraph: ReturnType<typeof buildReviewGraph>;

  public constructor(private readonly deps: AgentDeps) {
    const nodes = {
      validate: new ValidateNode(),
      load_policies: new LoadPoliciesNode(deps.policies),
      scan_injection: new ScanInjectionNode(),
      classify: new ClassifyNode(deps.llm),
      gather: new GatherNode(deps.orders),
      check_eligibility: new CheckEligibilityNode(deps.now),
      decide: new DecideNode(),
      execute_refund: new ExecuteRefundNode(deps.orders, deps.now),
      cite_policies: new CitePoliciesNode(),
      draft_reply: new DraftReplyNode(deps.llm),
      finalize: new FinalizeNode(deps.audit, deps.now),
      human_review: new HumanReviewNode(),
      apply_review: new ApplyReviewNode(deps.orders, deps.now),
    };
    this.graph = buildGraph(nodes);
    this.reviewGraph = buildReviewGraph(nodes, deps.checkpointer);
  }

  public async run(raw: unknown, options: RunOptions = {}): Promise<Result> {
    const finalState = await this.graph.invoke({
      raw,
      lookup: 'skipped',
      relatedPolicies: [],
      refundAmount: 0,
      reply: '',
    });
    if (!finalState.result) throw this.invariant('The agent finished without producing a result.');

    if (options.reviewId && reviewableEscalation(finalState)) {
      return this.pauseForReview(finalState, finalState.result, options.reviewId);
    }
    return finalState.result;
  }

  /**
   * Continue a paused run with the reviewer's answer and return the final result. Safe to call again after a failure:
   * it picks up from the last saved step. If an earlier attempt already applied an answer (money may have moved on it),
   * that answer stands and is what the result says, whatever answer this call was given. `consumed` says which it was.
   */
  public async resume(review: Pick<ReviewRecord, 'threadId'>, answer: ReviewAnswer): Promise<ResumedReview> {
    const config = this.configFor(review.threadId);
    const saved = await this.reviewGraph.getState(config);

    let state: AgentState;
    let consumed: boolean;
    if (saved.next.includes(STEP.HUMAN_REVIEW)) {
      state = await this.reviewGraph.invoke(new Command({ resume: answer }), config);
      consumed = true; // the run was still waiting, so this is the answer it used
    } else {
      // An earlier attempt already took an answer. It stands; this call only carries the run to its end. The answer is
      // still this caller's own if they are the one who gave it (a reviewer retrying after a failure).
      state = saved.next.length === 0 ? saved.values : await this.reviewGraph.invoke(null, config);
      consumed = this.isSame(saved.values.review, answer);
    }
    if (!state.result) throw this.invariant('The run did not finish after the review.');
    return { result: state.result, consumed }; // the saved run stays until `discard`, so a failure while recording can be retried
  }

  private isSame(earlier: AgentState['review'], answer: ReviewAnswer): boolean {
    const status = answer.action === 'approve' ? 'approved' : 'denied';
    return earlier !== undefined && earlier.reviewer === answer.reviewer && earlier.status === status;
  }

  /** Forget a run once its answer is fully recorded. */
  public async discard(review: Pick<ReviewRecord, 'threadId'>): Promise<void> {
    await this.deps.checkpointer.deleteThread(review.threadId);
  }

  private async pauseForReview(state: AgentState, result: Result, reviewId: string): Promise<Result> {
    const threadId = randomUUID();
    const config = this.configFor(threadId);
    try {
      await this.reviewGraph.invoke(state, config); // runs to the interrupt and stops there, saved
      if (!(await this.isWaiting(config))) throw this.invariant('The review run did not wait for a reviewer.');

      const pending: Result = { ...result, review: { status: 'pending' } };
      await this.deps.reviews.open({ reviewId, ticketId: pending.ticketId, threadId, request: pending });
      return pending;
    } catch (error) {
      await this.deps.checkpointer.deleteThread(threadId); // nothing is waiting on it
      throw error;
    }
  }

  private async isWaiting(config: ThreadConfig): Promise<boolean> {
    return (await this.reviewGraph.getState(config)).next.includes(STEP.HUMAN_REVIEW);
  }

  private configFor(threadId: string): ThreadConfig {
    return { configurable: { thread_id: threadId } };
  }

  private invariant(message: string): BusinessLogicError {
    return new BusinessLogicError(message, ErrorCodes.AGENT_STATE_INVARIANT);
  }
}
