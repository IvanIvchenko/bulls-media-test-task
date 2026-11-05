import type { LlmCall } from '../../src/llm/typedef.js';

/** A fake model answer, with some made-up usage. */
export const answered = <T>(value: T): LlmCall<T> => ({
  value,
  usage: { model: 'fake', inputTokens: 100, outputTokens: 20, attempts: 1 },
});
