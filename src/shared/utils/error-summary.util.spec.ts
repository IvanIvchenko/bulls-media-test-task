import { describe, expect, it } from 'vitest';

import { summarizeError } from './error-summary.util.js';
import { BusinessLogicError } from '../errors/business-logic-error.js';
import { ErrorCodes } from '../errors/error-codes.js';

describe('summarizeError', () => {
  it('gives the code of a business error, not its message', () => {
    const error = new BusinessLogicError('secret detail', ErrorCodes.LLM_BAD_RESPONSE);
    expect(summarizeError(error)).toBe('LLM_BAD_RESPONSE');
  });

  it('gives the HTTP status of an error from another system, not its body', () => {
    expect(summarizeError(Object.assign(new Error('{"key":"sk-ant-123"}'), { status: 429 }))).toBe('HTTP 429');
  });

  it('gives the type of a named error', () => {
    class TimeoutError extends Error {
      public override name = 'TimeoutError';
    }
    expect(summarizeError(new TimeoutError('after 20000 ms to https://internal.example'))).toBe('TimeoutError');
  });

  it('says only "unexpected error" when there is nothing safe to say', () => {
    for (const error of [new Error('anna@example.com'), 'a string with a secret', null, undefined, 42, {}]) {
      expect(summarizeError(error)).toBe('unexpected error');
    }
  });

  it('never contains the message of any error it is given', () => {
    const message = 'password=hunter2 anna@example.com +380501234567';
    for (const error of [
      new Error(message),
      new TypeError(message),
      Object.assign(new Error(message), { status: 500 }),
    ]) {
      expect(summarizeError(error)).not.toContain('hunter2');
      expect(summarizeError(error)).not.toContain('anna@');
    }
  });
});
