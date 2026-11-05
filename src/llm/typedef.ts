import type { Classification, LlmUsage, ReplyContext, Ticket } from '../domain/index.js';

export type { ReplyContext };

/** A model answer together with what it cost. */
export interface LlmCall<T> {
  value: T;
  usage: LlmUsage;
}

export interface LLM {
  readonly name: string;
  classify(ticket: Ticket): Promise<LlmCall<Classification>>;
  draftReply(ctx: ReplyContext): Promise<LlmCall<string>>;
}
