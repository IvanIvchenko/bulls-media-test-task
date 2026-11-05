import type { AgentState } from './typedef.js';
import type { TraceEntry } from '../domain/index.js';
import { redactPii } from '../guardrails/pii.util.js';
import { Logger } from '../shared/logger/logger.js';

const logger = new Logger('Agent');

/** Record one trace entry and emit it as a structured log line. PII is masked in both. */
export function step(state: AgentState, entry: TraceEntry): TraceEntry[] {
  const safeEntry = { ...entry, detail: redactPii(entry.detail) };
  logger.log('agent step', { ticketId: state.ticket?.ticketId, ...safeEntry });
  return [safeEntry];
}
