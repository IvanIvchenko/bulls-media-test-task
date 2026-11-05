import { describe, expect, it } from 'vitest';

import { PoliciesMapper } from './policies.mapper.js';
import type { SettingRow } from './typedef.js';

const settings: SettingRow[] = [
  { key: 'return_window_days', value: 30, rule_id: 'R1' },
  { key: 'defect_window_days', value: 60, rule_id: 'R2' },
  { key: 'auto_approve_limit', value: 100, rule_id: 'R5' },
];
const mapper = new PoliciesMapper();

describe('PoliciesMapper', () => {
  it('builds the eligibility config from setting and category rows', () => {
    const config = mapper.toConfig(settings, [
      { category: 'digital', verdict: 'escalate', rule_id: 'R3', reason: 'Digital goods.' },
    ]);
    expect(config).toEqual({
      returnWindow: { days: 30, ruleId: 'R1' },
      defectWindow: { days: 60, ruleId: 'R2' },
      autoApproveLimit: { amount: 100, ruleId: 'R5' },
      categoryRules: { digital: { verdict: 'escalate', ruleId: 'R3', reason: 'Digital goods.' } },
    });
  });

  it('names the missing key and carries a stable error code', () => {
    const without = settings.filter((row) => row.key !== 'defect_window_days');
    expect(() => mapper.toConfig(without, [])).toThrow(
      expect.objectContaining({
        code: 'POLICY_SETTING_MISSING',
        message: expect.stringContaining('defect_window_days'),
      }),
    );
  });

  it('fills placeholders, printing money with two decimals and leaving unknown ones visible', () => {
    const [rule] = mapper.toRules(
      [{ id: 'X', title: 'T', text: '{{return_window_days}} days, limit {{auto_approve_limit}}, {{nope}}' }],
      settings,
    );
    expect(rule?.text).toBe('30 days, limit 100.00, {{nope}}');
  });
});
