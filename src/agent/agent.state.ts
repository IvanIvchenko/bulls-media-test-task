import { Annotation } from '@langchain/langgraph';

import type {
  Classification,
  Eligibility,
  Order,
  OrderLookup,
  PolicyRule,
  PolicySnapshot,
  Result,
  Ticket,
  TraceEntry,
  Verdict,
} from '../domain/index.js';

/** Flags and trace entries accumulate: every step adds its own. */
const appended = <T>() => ({
  reducer: (existing: T[], incoming: T[]) => existing.concat(incoming),
  default: () => [] as T[],
});

/**
 * The decision's explanation belongs to whichever step decided last. When a refund the policy approved cannot be
 * recorded, the new reasons must replace the approval's, not sit beside them.
 */
const replaced = <T>() => ({
  reducer: (_existing: T[], incoming: T[]) => incoming,
  default: () => [] as T[],
});

/** What flows through the graph, grouped by the stage that fills it in. */
export const State = Annotation.Root({
  // -- input
  raw: Annotation<unknown>,
  ticket: Annotation<Ticket | undefined>,
  /** The policy as it was when this ticket started: loaded once, then used from memory. */
  policies: Annotation<PolicySnapshot | undefined>,

  // -- understanding (load_policies, classify, gather)
  classification: Annotation<Classification | undefined>,
  orderId: Annotation<string | undefined>,
  order: Annotation<Order | undefined>,
  lookup: Annotation<OrderLookup>,
  /** Rules the keyword search found relevant (hints for human reviewers). */
  relatedPolicies: Annotation<PolicyRule[]>,

  // -- evidence (check_eligibility)
  eligibility: Annotation<Eligibility | undefined>,

  // -- decision (decide, execute_refund, cite_policies)
  decision: Annotation<Verdict | undefined>,
  refundAmount: Annotation<number>,
  reasons: Annotation<string[]>(replaced<string>()),
  citations: Annotation<string[]>(replaced<string>()),
  /** Facts the reply may use. */
  facts: Annotation<string[]>(replaced<string>()),
  /** Text of the rules the decision cited, shown to the reply writer. */
  policyNotes: Annotation<string[]>(replaced<string>()),

  // -- output (draft_reply, finalize)
  reply: Annotation<string>,
  flags: Annotation<string[]>(appended<string>()),
  trace: Annotation<TraceEntry[]>(appended<TraceEntry>()),
  result: Annotation<Result | undefined>,
});
