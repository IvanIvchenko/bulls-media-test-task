import type { SETTING_KEYS } from './constants.js';
import type { Order } from '../domain/index.js';

export interface SettingRow {
  key: string;
  value: number;
  rule_id: string;
}

export interface CategoryRuleRow {
  category: Order['category'];
  verdict: 'deny' | 'escalate';
  rule_id: string;
  reason: string;
}

export interface RuleRow {
  id: string;
  title: string;
  text: string;
}

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
