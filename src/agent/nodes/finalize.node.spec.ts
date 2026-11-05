import { describe, expect, it, vi } from 'vitest';

import { NOW } from '../../../test/support/helpers.js';
import { classification, snapshot, stateWith, ticket } from '../../../test/support/nodes.js';
import type { AuditTrail } from '../../domain/index.js';
import type { AgentState } from '../typedef.js';
import { FinalizeNode } from './finalize.node.js';

describe('FinalizeNode', () => {
  const finalState = (patch: Partial<AgentState> = {}) =>
    stateWith({
      ticket,
      policies: snapshot,
      classification,
      decision: 'deny',
      reasons: ['Outside the window.'],
      citations: ['R1'],
      reply: 'Hello.',
      trace: [{ step: 'validate', ok: true, detail: 'input valid' }],
      ...patch,
    });
  const audit = () => {
    const record = vi.fn(async () => undefined);
    return { audit: { record } satisfies AuditTrail, record };
  };

  it('builds a validated result and writes it to the audit trail once', async () => {
    const { audit: trail, record } = audit();
    const { result } = await new FinalizeNode(trail, () => NOW).execute(finalState());
    expect(result).toMatchObject({
      ticketId: 'T-1',
      decision: 'deny',
      intent: 'refund_request',
      policyCitations: ['R1'],
      handoff: null,
    });
    expect(result?.summary).toBe('Ticket T-1: DENY. Outside the window.');
    expect(record).toHaveBeenCalledWith(result, NOW);
  });

  it('still returns the decision, flagged, when the audit write fails', async () => {
    const trail: AuditTrail = {
      record: async () => {
        throw new Error('disk full');
      },
    };
    const { result } = await new FinalizeNode(trail, () => NOW).execute(finalState());
    expect(result?.decision).toBe('deny');
    expect(result?.flags).toContain('audit_failed');
  });

  it('gives only an escalation a handoff, with the cited rules first and then the suggestions', async () => {
    const { audit: trail } = audit();
    const suggested = snapshot.rules.filter((rule) => rule.id === 'S2');
    const { result } = await new FinalizeNode(trail, () => NOW).execute(
      finalState({ decision: 'escalate', citations: ['R5'], relatedPolicies: suggested }),
    );
    expect(result?.handoff?.policies.map((policy) => `${policy.id}:${policy.source}`)).toEqual([
      'R5:cited',
      'S2:suggested',
    ]);

    const { result: denied } = await new FinalizeNode(trail, () => NOW).execute(finalState());
    expect(denied?.handoff).toBeNull();
  });

  it('does not suggest a rule it already cited', async () => {
    const { audit: trail } = audit();
    const { result } = await new FinalizeNode(trail, () => NOW).execute(
      finalState({
        decision: 'escalate',
        citations: ['R5'],
        relatedPolicies: snapshot.rules.filter((rule) => rule.id === 'R5'),
      }),
    );
    expect(result?.handoff?.policies.map((policy) => policy.id)).toEqual(['R5']);
  });

  it('names the ticket even when validation failed, capped and only if it is a string', async () => {
    const { audit: trail } = audit();
    const node = new FinalizeNode(trail, () => NOW);
    const invalid = { ticket: undefined, policies: undefined, classification: undefined, decision: 'refuse' as const };
    expect((await node.execute(finalState({ ...invalid, raw: { ticketId: 'x'.repeat(100) } }))).result?.ticketId).toBe(
      'x'.repeat(40),
    );
    expect((await node.execute(finalState({ ...invalid, raw: { ticketId: 5 } }))).result?.ticketId).toBe('unknown');
    expect((await node.execute(finalState({ ...invalid, raw: null }))).result?.ticketId).toBe('unknown');
  });

  it('mentions the flags and the refund amount in the summary', async () => {
    const { audit: trail } = audit();
    const { result } = await new FinalizeNode(trail, () => NOW).execute(
      finalState({ decision: 'approve', refundAmount: 59.9, flags: ['reply_llm_failed'] }),
    );
    expect(result?.summary).toContain('(refund 59.90)');
    expect(result?.summary).toContain('Flags: reply_llm_failed.');
  });

  it('totals the model calls in the trace, and counts nothing for steps that were not model calls', async () => {
    const { audit: trail } = audit();
    const usage = (inputTokens: number, outputTokens: number) => ({
      model: 'm',
      inputTokens,
      outputTokens,
      attempts: 1,
    });
    const { result } = await new FinalizeNode(trail, () => NOW).execute(
      finalState({
        trace: [
          { step: 'validate', ok: true, detail: 'input valid', ms: 3 },
          { step: 'classify', ok: true, detail: '{}', ms: 400, llm: usage(120, 30) },
          { step: 'classify', ok: false, detail: 'failed', ms: 900 }, // no usage: a failed call
          { step: 'draft_reply', ok: true, detail: 'reply drafted', ms: 250, llm: usage(300, 80) },
        ],
      }),
    );
    expect(result?.usage).toEqual({ llmCalls: 2, inputTokens: 420, outputTokens: 110, llmMs: 650 });
  });

  it('reports zero usage when the model was never called', async () => {
    const { audit: trail } = audit();
    const { result } = await new FinalizeNode(trail, () => NOW).execute(finalState());
    expect(result?.usage).toEqual({ llmCalls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0 });
  });

  it('puts the flags of the latest reply draft on the result with the rest, once each', async () => {
    const { audit: trail } = audit();
    const { result } = await new FinalizeNode(trail, () => NOW).execute(
      finalState({ flags: ['order_id_conflict', 'reply_llm_failed'], replyFlags: ['reply_llm_failed'] }),
    );
    expect(result?.flags).toEqual(['order_id_conflict', 'reply_llm_failed']);
    expect(result?.summary).toContain('Flags: order_id_conflict, reply_llm_failed.');
  });

  it('has no reply flag when the latest draft was fine, which is what a redraft after a review leaves', async () => {
    const { audit: trail } = audit();
    const { result } = await new FinalizeNode(trail, () => NOW).execute(finalState({ replyFlags: [] }));
    expect(result?.flags).toEqual([]);
  });
});
