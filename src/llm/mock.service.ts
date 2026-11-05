import type { LLM, LlmCall } from './typedef.js';
import {
  ORDER_ID_PREFIX,
  templateReply,
  type Classification,
  type LlmUsage,
  type ReplyContext,
  type Ticket,
} from '../domain/index.js';

/** What the real model is asked to do: "#1001", "ord 1001" and the full id all come out as the canonical id. */
const MENTION = /(?:\bord[-\s]?|#)(\d{4,8})\b/i;
const mentionedOrderId = (text: string): string | null => {
  const digits = text.match(MENTION)?.[1];
  return digits ? `${ORDER_ID_PREFIX}${digits}` : null;
};

const MOCK_USAGE: LlmUsage = { model: 'mock', inputTokens: 0, outputTokens: 0, attempts: 1 };

/** Deterministic keyword-based stand-in for the model. Used for offline runs and CI. */
export class MockLlmService implements LLM {
  public readonly name = 'mock';

  public async classify(ticket: Ticket): Promise<LlmCall<Classification>> {
    const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
    const orderIdMentioned = mentionedOrderId(`${ticket.subject} ${ticket.body}`);
    const refund = /refund|money back|return|broken|defective|doesn'?t work|not working/.test(text);
    const status = /where is|tracking|status|when will/.test(text);
    const intent = refund ? 'refund_request' : status ? 'order_status' : 'other';
    const refundReason = !refund
      ? null
      : /broken|defective|doesn'?t work|not working|stopped working|damaged/.test(text)
        ? 'defective'
        : /not as described|different from|wrong item/.test(text)
          ? 'not_as_described'
          : /late|delay/.test(text)
            ? 'late_delivery'
            : /changed my mind|don'?t want|no longer/.test(text)
              ? 'changed_mind'
              : 'other';
    const urgency = /urgent|asap|immediately/.test(text) ? 'high' : 'normal';
    const asks = `${ticket.subject}\n${ticket.body}`
      .split(/(?<=[.!?])\s+|\n+/)
      .find((sentence) => /refund|money back|reimburs|return/i.test(sentence));
    const value: Classification = {
      intent,
      refundReason,
      urgency,
      orderIdMentioned,
      refundRequestQuote: asks?.trim().slice(0, 300) ?? null,
    };
    return { value, usage: MOCK_USAGE };
  }

  public async draftReply(ctx: ReplyContext): Promise<LlmCall<string>> {
    return { value: templateReply(ctx), usage: MOCK_USAGE };
  }
}
