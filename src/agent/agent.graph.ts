import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';

import { State } from './agent.state.js';
import { STEP } from './constants.js';
import type { AgentNode, AgentState } from './typedef.js';
import { FLAG, refundedBy } from '../domain/index.js';

/** One node instance per step. The graph decides the order; each node decides nothing about routing. */
export type AgentNodes = Record<
  | typeof STEP.VALIDATE
  | typeof STEP.LOAD_POLICIES
  | typeof STEP.SCAN_INJECTION
  | typeof STEP.CLASSIFY
  | typeof STEP.GATHER
  | typeof STEP.CHECK_ELIGIBILITY
  | typeof STEP.DECIDE
  | typeof STEP.EXECUTE_REFUND
  | typeof STEP.CITE_POLICIES
  | typeof STEP.DRAFT_REPLY
  | typeof STEP.FINALIZE
  | typeof STEP.HUMAN_REVIEW
  | typeof STEP.APPLY_REVIEW,
  AgentNode
>;

// ---- routing: pure functions of state, easy to read and test ----

/** Invalid input skips straight to the reply: it never touches the database. */
const afterValidate = (state: AgentState) => (state.ticket ? STEP.LOAD_POLICIES : STEP.DRAFT_REPLY);

/** Skip tools when classification is unusable or the ticket looks hostile. */
const afterClassify = (state: AgentState) =>
  state.classification && !state.flags.includes(FLAG.PROMPT_INJECTION_SUSPECTED) ? STEP.GATHER : STEP.DECIDE;

/** Eligibility only matters for refund requests on a verified order that this ticket has not already had refunded. */
const afterGather = (state: AgentState) =>
  state.classification?.intent === 'refund_request' &&
  state.lookup === 'found' &&
  !refundedBy(state.order, state.ticket?.ticketId)
    ? STEP.CHECK_ELIGIBILITY
    : STEP.DECIDE;

/** The only path to a side effect. */
const afterDecide = (state: AgentState) => (state.decision === 'approve' ? STEP.EXECUTE_REFUND : STEP.CITE_POLICIES);

const run = (node: AgentNode) => (state: AgentState) => node.execute(state);

/** The workflow: ticket in, decision and reply out. It never pauses and never touches a checkpointer. */
export function buildGraph(nodes: AgentNodes) {
  return new StateGraph(State)
    .addNode(STEP.VALIDATE, run(nodes.validate))
    .addNode(STEP.LOAD_POLICIES, run(nodes.load_policies))
    .addNode(STEP.SCAN_INJECTION, run(nodes.scan_injection))
    .addNode(STEP.CLASSIFY, run(nodes.classify))
    .addNode(STEP.GATHER, run(nodes.gather))
    .addNode(STEP.CHECK_ELIGIBILITY, run(nodes.check_eligibility))
    .addNode(STEP.DECIDE, run(nodes.decide))
    .addNode(STEP.EXECUTE_REFUND, run(nodes.execute_refund))
    .addNode(STEP.CITE_POLICIES, run(nodes.cite_policies))
    .addNode(STEP.DRAFT_REPLY, run(nodes.draft_reply))
    .addNode(STEP.FINALIZE, run(nodes.finalize))
    .addEdge(START, STEP.VALIDATE)
    .addConditionalEdges(STEP.VALIDATE, afterValidate, [STEP.LOAD_POLICIES, STEP.DRAFT_REPLY])
    .addEdge(STEP.LOAD_POLICIES, STEP.SCAN_INJECTION)
    .addEdge(STEP.SCAN_INJECTION, STEP.CLASSIFY)
    .addConditionalEdges(STEP.CLASSIFY, afterClassify, [STEP.GATHER, STEP.DECIDE])
    .addConditionalEdges(STEP.GATHER, afterGather, [STEP.CHECK_ELIGIBILITY, STEP.DECIDE])
    .addEdge(STEP.CHECK_ELIGIBILITY, STEP.DECIDE)
    .addConditionalEdges(STEP.DECIDE, afterDecide, [STEP.EXECUTE_REFUND, STEP.CITE_POLICIES])
    .addEdge(STEP.EXECUTE_REFUND, STEP.CITE_POLICIES)
    .addEdge(STEP.CITE_POLICIES, STEP.DRAFT_REPLY)
    .addEdge(STEP.DRAFT_REPLY, STEP.FINALIZE)
    .addEdge(STEP.FINALIZE, END)
    .compile();
}

/**
 * The part of a run that waits for a person. It starts from the state the workflow ended with, pauses at once
 * (`human_review` calls `interrupt()`), and on resume applies the answer and answers the customer again. Only runs
 * that reach this graph are saved, so a ticket that never needs a reviewer writes nothing extra.
 */
export function buildReviewGraph(nodes: AgentNodes, checkpointer: BaseCheckpointSaver) {
  return new StateGraph(State)
    .addNode(STEP.HUMAN_REVIEW, run(nodes.human_review))
    .addNode(STEP.APPLY_REVIEW, run(nodes.apply_review))
    .addNode(STEP.DRAFT_REPLY, run(nodes.draft_reply))
    .addNode(STEP.FINALIZE, run(nodes.finalize))
    .addEdge(START, STEP.HUMAN_REVIEW)
    .addEdge(STEP.HUMAN_REVIEW, STEP.APPLY_REVIEW)
    .addEdge(STEP.APPLY_REVIEW, STEP.DRAFT_REPLY)
    .addEdge(STEP.DRAFT_REPLY, STEP.FINALIZE)
    .addEdge(STEP.FINALIZE, END)
    .compile({ checkpointer });
}
