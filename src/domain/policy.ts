import type { Order } from './order.js';

/** Rule ids the code refers to directly. PolicyStore checks at startup that every one exists in the database. */
export const RULE = {
  ALREADY_REFUNDED: 'R6',
  IDENTITY: 'R7',
  ORDER_STATUS: 'S1',
  OUT_OF_SCOPE: 'S3',
} as const;

/** A policy rule as stored in the database, with {{placeholders}} already filled from the current settings. */
export interface PolicyRule {
  id: string;
  title: string;
  text: string;
}

export interface CategoryRule {
  verdict: 'deny' | 'escalate';
  ruleId: string;
  reason: string;
}

/** The numbers and category rules that drive eligibility. Read from the database on every use, so edits take effect. */
export interface PolicyConfig {
  returnWindow: { days: number; ruleId: string };
  defectWindow: { days: number; ruleId: string };
  autoApproveLimit: { amount: number; ruleId: string };
  categoryRules: Partial<Record<Order['category'], CategoryRule>>;
}
