import type { CategoryRuleRow, RuleRow, SettingRow } from './typedef.js';
import { TABLE } from '../db/constants.js';
import type { Database } from '../db/typedef.js';

/** Reads on every call, so a changed row takes effect immediately. */
export class PoliciesRepository {
  public constructor(private readonly database: Database) {}

  public async findSettings(): Promise<SettingRow[]> {
    return this.database<SettingRow>(TABLE.POLICY_SETTINGS).select('key', 'value', 'rule_id');
  }

  public async findCategoryRules(): Promise<CategoryRuleRow[]> {
    return this.database<CategoryRuleRow>(TABLE.CATEGORY_RULES).select('category', 'verdict', 'rule_id', 'reason');
  }

  public async findRules(): Promise<RuleRow[]> {
    return this.database<RuleRow>(TABLE.POLICY_RULES).select('id', 'title', 'text').orderBy('id');
  }
}
