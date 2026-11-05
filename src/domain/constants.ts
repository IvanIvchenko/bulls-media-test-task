/** What a ticket id from a client may look like. */
export const TICKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The one definition of an order id. Validation, the classifier's prompt, the mock model and the reply guard (which uses
 * it to spot another customer's order id) all read it from here, so changing the format is one edit and the guard
 * cannot silently stop recognising ids that validation still accepts.
 */
export const ORDER_ID_PREFIX = 'ORD-';
/** The part after the prefix, as regular-expression source. */
export const ORDER_ID_DIGITS = '\\d{4,8}';
export const ORDER_ID_EXAMPLE = `${ORDER_ID_PREFIX}1234`;
const escapeForRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole string is an order id. */
export const ORDER_ID_PATTERN = new RegExp(`^${escapeForRegExp(ORDER_ID_PREFIX)}${ORDER_ID_DIGITS}$`);
/** The same shape on word boundaries, to find order ids inside text (see `orderIdsIn`). Never matches part of a word or number. */
export const ORDER_ID_IN_TEXT_SOURCE = `\\b${escapeForRegExp(ORDER_ID_PREFIX)}${ORDER_ID_DIGITS}\\b`;

/** Flags the agent attaches to a result. Shared by the decision policy, the nodes and the HTTP layer. */
export const FLAG = {
  INVALID_INPUT: 'invalid_input',
  PROMPT_INJECTION_SUSPECTED: 'prompt_injection_suspected',
  CLASSIFIER_FAILED: 'classifier_failed',
  ORDER_ID_CONFLICT: 'order_id_conflict',
  REPLY_REJECTED_BY_GUARD: 'reply_rejected_by_guard',
  REPLY_LLM_FAILED: 'reply_llm_failed',
  AUDIT_FAILED: 'audit_failed',
} as const;
