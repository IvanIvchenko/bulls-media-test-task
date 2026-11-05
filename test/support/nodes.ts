import { expect, vi } from 'vitest';

import { createTestContainer } from './helpers.js';
import { answered } from './llm.js';
import type { AgentState } from '../../src/agent/typedef.js';
import type {
  Classification,
  LookupResult,
  Order,
  OrderTools,
  PolicySnapshot,
  RefundResult,
  Ticket,
} from '../../src/domain/index.js';
import type { LLM } from '../../src/llm/typedef.js';

/* Fixtures for the node specs: one node at a time, against fake ports, with no database, model or graph in the way. */

export const snapshot: PolicySnapshot = await (await createTestContainer()).policies.loadSnapshot();

export const ticket: Ticket = {
  ticketId: 'T-1',
  customerEmail: 'anna@example.com',
  orderId: 'ORD-1001',
  subject: 'Refund',
  body: 'I changed my mind about the headphones.',
};
export const order: Order = {
  orderId: 'ORD-1001',
  customerEmail: 'anna@example.com',
  item: 'Wireless Headphones',
  category: 'physical',
  amount: 59.9,
  status: 'delivered',
  deliveredAt: '2026-10-20',
  refunded: false,
};
export const classification: Classification = {
  intent: 'refund_request',
  refundReason: 'changed_mind',
  urgency: 'normal',
  orderIdMentioned: null,
  refundRequestQuote: 'I changed my mind about the headphones.',
};

/** A state with nothing filled in yet, like the start of a run. */
export const blank = (): AgentState => ({
  raw: undefined,
  ticket: undefined,
  policies: undefined,
  classification: undefined,
  orderId: undefined,
  order: undefined,
  lookup: 'skipped',
  relatedPolicies: [],
  eligibility: undefined,
  decision: undefined,
  refundAmount: 0,
  reasons: [],
  citations: [],
  facts: [],
  policyNotes: [],
  reply: '',
  flags: [],
  trace: [],
  result: undefined,
  review: undefined,
});
export const stateWith = (patch: Partial<AgentState>): AgentState => ({ ...blank(), ...patch });

export const outOfOrder = (node: { execute(state: AgentState): Promise<unknown> }, missing: RegExp) =>
  expect(node.execute(blank())).rejects.toMatchObject({
    code: 'AGENT_STATE_INVARIANT',
    message: expect.stringMatching(missing),
  });

export const fakeOrders = (lookup: LookupResult, refund: RefundResult = { ok: true }) => {
  const lookupOrder = vi.fn(async () => lookup);
  const recordRefund = vi.fn(async () => refund);
  return { orders: { lookupOrder, recordRefund } satisfies OrderTools, lookupOrder, recordRefund };
};
export const fakeLlm = (overrides: Partial<LLM> = {}): LLM => ({
  name: 'fake',
  classify: async () => answered(classification),
  draftReply: async () => answered('Hello, we cannot refund this order.'),
  ...overrides,
});
