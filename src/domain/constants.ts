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
