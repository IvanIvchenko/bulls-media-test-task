import { FLAG, templateReply, type LlmUsage, type ReplyContext, type TemplateContext } from '../../domain/index.js';
import { checkReply } from '../../guardrails/output.util.js';
import type { LLM } from '../../llm/typedef.js';
import { Logger } from '../../shared/logger/logger.js';
import { summarizeError } from '../../shared/utils/error-summary.util.js';
import { STEP } from '../constants.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/**
 * Draft the reply with the LLM, run the output guard, fall back to a template on any problem. Two cases never reach
 * the model at all: input that did not validate (nothing trustworthy to show it) and a refusal.
 */
export class DraftReplyNode implements AgentNode {
  private readonly logger = new Logger(DraftReplyNode.name);

  public constructor(private readonly llm: LLM) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const decision = state.decision ?? 'refuse';
    const template: TemplateContext = {
      decision,
      facts: state.facts, // never the internal reasons: they are written for the reviewer
      policyNotes: state.policyNotes,
      refundAmount: state.refundAmount,
    };

    if (!state.ticket) return this.fixed(state, template, 'template (invalid input)');
    // A refusal is the same words for every ticket, byte for byte: a wrong sender and an unknown order must not be
    // told apart, and a model would word them differently.
    if (decision === 'refuse') return this.fixed(state, template, 'template (refusals are fixed text)');

    return this.draft(state, { ...template, ticket: state.ticket });
  }

  private fixed(state: AgentState, template: TemplateContext, detail: string): AgentStateUpdate {
    return {
      reply: templateReply(template),
      replyFlags: [],
      trace: step(state, { step: STEP.DRAFT_REPLY, ok: true, detail }),
    };
  }

  private async draft(state: AgentState, context: ReplyContext): Promise<AgentStateUpdate> {
    const startedAt = Date.now();
    const trace = (ok: boolean, detail: string, llm?: LlmUsage) =>
      step(state, { step: STEP.DRAFT_REPLY, tool: this.llm.name, ok, detail, ms: Date.now() - startedAt, llm });
    const fallback = templateReply(context);

    try {
      const { value: draft, usage } = await this.llm.draftReply(context);
      const problems = checkReply(draft, {
        decision: context.decision,
        orderIds: state.orderId ? [state.orderId] : [],
        refundAmount: state.refundAmount,
        allowedText: [...context.facts, ...context.policyNotes],
      });
      if (problems.length === 0) return { reply: draft, replyFlags: [], trace: trace(true, 'reply drafted', usage) };

      // Debug level only: the draft is model output about a customer, kept out of the normal logs and the trace.
      this.logger.debug('reply draft rejected', { ticketId: context.ticket.ticketId, problems, draft });
      return {
        reply: fallback,
        replyFlags: [FLAG.REPLY_REJECTED_BY_GUARD],
        trace: trace(false, `rejected: ${problems.join('; ')}; used template`, usage),
      };
    } catch (error) {
      this.logger.warn('reply drafting failed', { ticketId: context.ticket.ticketId, err: String(error) });
      return {
        reply: fallback,
        replyFlags: [FLAG.REPLY_LLM_FAILED],
        trace: trace(false, `reply drafting failed (${summarizeError(error)}); used template`),
      };
    }
  }
}
