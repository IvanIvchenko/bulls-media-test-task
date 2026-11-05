import Anthropic from '@anthropic-ai/sdk';

import { CLASSIFY_MAX_TOKENS, REPLY_MAX_TOKENS } from './constants.js';
import {
  CLASSIFY_SYSTEM,
  CLASSIFY_TOOL,
  REPLY_SYSTEM,
  buildClassifyMessage,
  buildReplyMessage,
} from './llm.prompts.js';
import { isRetryableLlmError } from './retryable.util.js';
import type { LLM, LlmCall } from './typedef.js';
import type { ConfigService } from '../config/config.service.js';
import { classificationSchema, type Classification, type ReplyContext, type Ticket } from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';
import { Logger } from '../shared/logger/logger.js';
import { summarizeError } from '../shared/utils/error-summary.util.js';
import { withRetry } from '../shared/utils/retry.util.js';

/** Claude. Classification is a forced tool call validated by Zod; both calls are retried a bounded number of times. */
export class AnthropicLlmService implements LLM {
  private readonly logger = new Logger(AnthropicLlmService.name);
  private readonly client: Anthropic;
  private readonly model: string;
  public readonly name: string;

  public constructor(
    private readonly configService: ConfigService,
    client?: Anthropic,
  ) {
    this.model = configService.get('ANTHROPIC_MODEL');
    this.name = `anthropic:${this.model}`;
    // The SDK's own retries are off: ours are bounded, logged and counted in the trace.
    this.client =
      client ??
      new Anthropic({
        apiKey: configService.getOrThrow('ANTHROPIC_API_KEY'),
        timeout: configService.get('LLM_TIMEOUT_MS'),
        maxRetries: 0,
      });
  }

  public async classify(ticket: Ticket): Promise<LlmCall<Classification>> {
    return this.call(
      'classify',
      {
        model: this.model,
        max_tokens: CLASSIFY_MAX_TOKENS,
        system: CLASSIFY_SYSTEM,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
        messages: [{ role: 'user', content: buildClassifyMessage(ticket) }],
      },
      (response) => {
        const block = response.content.find((part) => part.type === 'tool_use');
        if (!block || block.type !== 'tool_use') {
          throw new BusinessLogicError('Model returned no tool_use block', ErrorCodes.LLM_BAD_RESPONSE);
        }
        return classificationSchema.parse(block.input); // throws -> retried
      },
    );
  }

  public async draftReply(ctx: ReplyContext): Promise<LlmCall<string>> {
    return this.call(
      'draftReply',
      {
        model: this.model,
        max_tokens: REPLY_MAX_TOKENS,
        system: REPLY_SYSTEM,
        messages: [{ role: 'user', content: buildReplyMessage(ctx) }],
      },
      (response) => {
        const text = response.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n')
          .trim();
        if (!text) throw new BusinessLogicError('Model returned an empty reply', ErrorCodes.LLM_BAD_RESPONSE);
        return text;
      },
    );
  }

  /**
   * One model call with bounded retries. Every attempt writes an `llm_call` log line (tokens, latency, outcome), so
   * even a call that ends in failure leaves its cost in the logs. The returned usage sums the attempts that reached
   * the API, because a reply that failed validation was still billed.
   */
  private async call<T>(
    operation: string,
    request: Anthropic.MessageCreateParamsNonStreaming,
    parse: (response: Anthropic.Message) => T,
  ): Promise<LlmCall<T>> {
    let attempts = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const value = await withRetry(
      async () => {
        attempts++;
        const startedAt = Date.now();
        let outcome = 'error';
        let tokens = { input: 0, output: 0 };
        try {
          const response = await this.client.messages.create(request);
          tokens = { input: response.usage.input_tokens, output: response.usage.output_tokens };
          inputTokens += tokens.input;
          outputTokens += tokens.output;
          outcome = 'invalid';
          const parsed = parse(response);
          outcome = 'ok';
          return parsed;
        } finally {
          this.logger.log('llm_call', {
            operation,
            model: this.model,
            attempt: attempts,
            inputTokens: tokens.input,
            outputTokens: tokens.output,
            ms: Date.now() - startedAt,
            outcome,
          });
        }
      },
      {
        ...this.retryOptions(),
        onRetry: (error, attempt) => this.logger.warn(`${operation} retry`, { reason: summarizeError(error), attempt }),
      },
    );
    return { value, usage: { model: this.model, inputTokens, outputTokens, attempts } };
  }

  /** Bounded retries with jitter, and only for errors that retrying can fix (not a bad key or a bad request). */
  private retryOptions() {
    return {
      retries: this.configService.get('LLM_MAX_RETRIES'),
      baseMs: this.configService.get('LLM_RETRY_BASE_MS'),
      shouldRetry: isRetryableLlmError,
    };
  }
}
