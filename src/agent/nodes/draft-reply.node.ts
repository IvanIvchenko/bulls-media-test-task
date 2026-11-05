import { FLAG, templateReply, type LlmUsage, type ReplyContext, type Ticket } from '../../domain/index.js';
import { checkReply } from '../../guardrails/output.util.js';
import type { LLM } from '../../llm/typedef.js';
import { Logger } from '../../shared/logger/logger.js';
import { summarizeError } from '../../shared/utils/error-summary.util.js';
import { STEP } from '../constants.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

const NO_TICKET: Ticket = { ticketId: 'unknown', customerEmail: '', subject: '', body: '' };

/** Draft the reply with the LLM, run the output guard, fall back to a template on any problem. */
export class DraftReplyNode implements AgentNode {
  private readonly logger = new Logger(DraftReplyNode.name);

  public constructor(private readonly llm: LLM) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const decision = state.decision ?? 'refuse';
    const context: ReplyContext = {
      ticket: state.ticket ?? NO_TICKET,
      decision,
      facts: state.facts.length ? state.facts : state.reasons,
      policyNotes: state.policyNotes,
      refundAmount: state.refundAmount,
    };
    const fallback = templateReply(context);

    // Invalid input never reaches the LLM (nothing trustworthy to show it).
    if (!state.ticket) {
      return {
        reply: fallback,
        trace: step(state, { step: STEP.DRAFT_REPLY, ok: true, detail: 'template (invalid input)' }),
      };
    }

    const startedAt = Date.now();
    const trace = (ok: boolean, detail: string, llm?: LlmUsage) =>
      step(state, { step: STEP.DRAFT_REPLY, tool: this.llm.name, ok, detail, ms: Date.now() - startedAt, llm });
    try {
      const { value: draft, usage } = await this.llm.draftReply(context);
      const problems = checkReply(draft, {
        decision,
        orderIds: state.orderId ? [state.orderId] : [],
        refundAmount: state.refundAmount,
        allowedText: [...context.facts, ...context.policyNotes],
      });
      if (problems.length) {
        return {
          reply: fallback,
          flags: [FLAG.REPLY_REJECTED_BY_GUARD],
          trace: trace(false, `rejected: ${problems.join('; ')}; used template`, usage),
        };
      }
      return { reply: draft, trace: trace(true, 'reply drafted', usage) };
    } catch (error) {
      this.logger.warn('reply drafting failed', { ticketId: state.ticket?.ticketId, err: String(error) });
      return {
        reply: fallback,
        flags: [FLAG.REPLY_LLM_FAILED],
        trace: trace(false, `reply drafting failed (${summarizeError(error)}); used template`),
      };
    }
  }
}
