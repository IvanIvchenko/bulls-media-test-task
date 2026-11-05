/** Graph node names. They double as the `step` of each trace entry. */
export const STEP = {
  VALIDATE: 'validate',
  LOAD_POLICIES: 'load_policies',
  SCAN_INJECTION: 'scan_injection',
  CLASSIFY: 'classify',
  GATHER: 'gather',
  CHECK_ELIGIBILITY: 'check_eligibility',
  DECIDE: 'decide',
  EXECUTE_REFUND: 'execute_refund',
  CITE_POLICIES: 'cite_policies',
  DRAFT_REPLY: 'draft_reply',
  FINALIZE: 'finalize',
  /** Trace-only steps: tool calls made inside the `gather` node. */
  SEARCH_POLICIES: 'search_policies',
  LOOKUP_ORDER: 'lookup_order',
} as const;

/** Tool names as they appear in the trace. */
export const TOOL = {
  LOAD_POLICY_SNAPSHOT: 'loadPolicySnapshot',
  SEARCH_POLICIES: 'searchPolicies',
  GET_POLICY_RULES: 'getPolicyRules',
  LOOKUP_ORDER: 'lookupOrder',
  RECORD_REFUND: 'recordRefund',
  CHECK_REFUND_ELIGIBILITY: 'checkRefundEligibility',
} as const;

/** Decisions whose explanation may quote policy text. Refusals and info replies never do. */
export const QUOTABLE_DECISIONS: ReadonlySet<string> = new Set(['approve', 'deny', 'escalate']);

export const UNKNOWN_TICKET_ID = 'unknown';
export const MAX_TICKET_ID_LENGTH = 40;
