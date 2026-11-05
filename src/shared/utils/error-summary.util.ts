import { BusinessLogicError } from '../errors/business-logic-error.js';

/**
 * A short description of an error that is safe to put in a response: a code or a type, never the message. Messages
 * from other systems can carry request ids, internal URLs or the very text that was sent. Log the full error
 * server-side instead.
 */
export function summarizeError(error: unknown): string {
  if (error instanceof BusinessLogicError) return error.code;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  if (error instanceof Error && error.name !== 'Error') return error.name;
  return 'unexpected error';
}
