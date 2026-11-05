import { FLAG } from '../../domain/index.js';
import type { LLM } from '../../llm/typedef.js';
import { Logger } from '../../shared/logger/logger.js';
import { summarizeError } from '../../shared/utils/error-summary.util.js';
import { STEP } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** LLM classification into a fixed schema. On failure, flag it: we escalate rather than guess. */
export class ClassifyNode implements AgentNode {
  private readonly logger = new Logger(ClassifyNode.name);

  public constructor(private readonly llm: LLM) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { ticket } = needs(state, 'ticket');
    const startedAt = Date.now();
    try {
      const { value: classification, usage } = await this.llm.classify(ticket);
      return {
        classification,
        trace: step(state, {
          step: STEP.CLASSIFY,
          tool: this.llm.name,
          ok: true,
          detail: JSON.stringify(classification),
          ms: Date.now() - startedAt,
          llm: usage,
        }),
      };
    } catch (error) {
      this.logger.warn('classification failed', { ticketId: state.ticket?.ticketId, err: String(error) });
      return {
        flags: [FLAG.CLASSIFIER_FAILED],
        trace: step(state, {
          step: STEP.CLASSIFY,
          tool: this.llm.name,
          ok: false,
          detail: `classification failed (${summarizeError(error)})`,
          ms: Date.now() - startedAt,
        }),
      };
    }
  }
}
