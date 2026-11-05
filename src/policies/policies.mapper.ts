import { MONEY_SETTING_SUFFIX, SETTING_KEYS } from './constants.js';
import type { CategoryRuleRow, RuleRow, SettingKey, SettingRow } from './typedef.js';
import { roundMoney, type PolicyConfig, type PolicyRule } from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

export class PoliciesMapper {
  /** Build the numbers and category rules that drive eligibility. Throws if a required setting is missing. */
  public toConfig(settings: SettingRow[], categoryRows: CategoryRuleRow[]): PolicyConfig {
    const byKey = new Map(settings.map((row) => [row.key, row]));
    const need = (key: SettingKey) => {
      const setting = byKey.get(key);
      if (!setting) {
        throw new BusinessLogicError(
          `policy_settings is missing required key "${key}"`,
          ErrorCodes.POLICY_SETTING_MISSING,
        );
      }
      return setting;
    };

    const categoryRules: PolicyConfig['categoryRules'] = {};
    for (const row of categoryRows) {
      categoryRules[row.category] = { verdict: row.verdict, ruleId: row.rule_id, reason: row.reason };
    }
    const returnWindow = need(SETTING_KEYS.RETURN_WINDOW_DAYS);
    const defectWindow = need(SETTING_KEYS.DEFECT_WINDOW_DAYS);
    const autoApproveLimit = need(SETTING_KEYS.AUTO_APPROVE_LIMIT);
    return {
      returnWindow: { days: returnWindow.value, ruleId: returnWindow.rule_id },
      defectWindow: { days: defectWindow.value, ruleId: defectWindow.rule_id },
      autoApproveLimit: { amount: roundMoney(Number(autoApproveLimit.value)), ruleId: autoApproveLimit.rule_id },
      categoryRules,
    };
  }

  /** Fill {{placeholders}} in rule text from the current settings, so numbers live in exactly one place. */
  public toRules(rows: RuleRow[], settings: SettingRow[]): PolicyRule[] {
    const values = new Map(settings.map((row) => [row.key, row.value]));
    return rows.map((row) => ({
      ...row,
      text: row.text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
        const value = values.get(key);
        if (value === undefined) return `{{${key}}}`;
        return key.endsWith(MONEY_SETTING_SUFFIX) ? value.toFixed(2) : String(value);
      }),
    }));
  }
}
