import { FLAG, pickRules, resultSchema, type AuditTrail, type Handoff } from '../../domain/index.js';
import { Logger } from '../../shared/logger/logger.js';
import { MAX_TICKET_ID_LENGTH, UNKNOWN_TICKET_ID } from '../constants.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** Assemble the final result, validate it against the schema, and write it to the audit trail. */
export class FinalizeNode implements AgentNode {
  private readonly logger = new Logger(FinalizeNode.name);

  public constructor(
    private readonly audit: AuditTrail,
    private readonly now: () => Date,
  ) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const decision = state.decision ?? 'escalate';
    const flags = [...new Set([...state.flags, ...state.replyFlags])];
    const ticketId = this.ticketIdOf(state);
    const summary =
      `Ticket ${ticketId}: ${decision.toUpperCase()}` +
      (decision === 'approve' ? ` (refund ${state.refundAmount.toFixed(2)})` : '') +
      `. ${state.reasons.join(' ')}` +
      (flags.length ? ` Flags: ${flags.join(', ')}.` : '');

    const result = resultSchema.parse({
      ticketId,
      decision,
      refundAmount: state.refundAmount ?? 0,
      intent: state.classification?.intent ?? null,
      reasons: state.reasons,
      policyCitations: [...new Set(state.citations)],
      handoff: decision === 'escalate' ? this.buildHandoff(state) : null,
      flags,
      reply: state.reply,
      summary,
      trace: state.trace,
      usage: this.usageOf(state),
      review: state.review,
    });

    try {
      await this.audit.record(result, this.now());
    } catch (error) {
      // The decision is still returned; the failure is visible in the flags and logs.
      this.logger.error('audit write failed', { ticketId, err: String(error) });
      result.flags.push(FLAG.AUDIT_FAILED);
    }
    this.logger.log('agent decision', { ticketId, decision, flags: result.flags, usage: result.usage });
    return { result };
  }

  /** Totals over the model calls in the trace. A call that failed has no usage in the trace; its attempts are in the logs. */
  private usageOf(state: AgentState) {
    const calls = state.trace.filter((entry) => entry.llm);
    return {
      llmCalls: calls.length,
      inputTokens: calls.reduce((sum, entry) => sum + (entry.llm?.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((sum, entry) => sum + (entry.llm?.outputTokens ?? 0), 0),
      llmMs: calls.reduce((sum, entry) => sum + (entry.ms ?? 0), 0),
    };
  }

  /** Best-effort ticket id even when validation failed (capped, string-only). */
  private ticketIdOf(state: AgentState): string {
    if (state.ticket) return state.ticket.ticketId;
    const raw = state.raw as { ticketId?: unknown } | null;
    return typeof raw?.ticketId === 'string' ? raw.ticketId.slice(0, MAX_TICKET_ID_LENGTH) : UNKNOWN_TICKET_ID;
  }

  /** For escalations: the cited rules first, then search suggestions not already cited. */
  private buildHandoff(state: AgentState): Handoff {
    const cited = pickRules(state.policies?.rules ?? [], [...new Set(state.citations)]);
    const citedIds = new Set(cited.map((rule) => rule.id));
    const suggested = state.relatedPolicies.filter((rule) => !citedIds.has(rule.id));
    return {
      reasons: state.reasons,
      policies: [
        ...cited.map((rule) => ({ ...rule, source: 'cited' as const })),
        ...suggested.map((rule) => ({ ...rule, source: 'suggested' as const })),
      ],
    };
  }
}
