import { describe, expect, it } from 'vitest';

import { createTestContainer } from '../../test/support/helpers.js';
import { pickRules, rankRules } from '../domain/index.js';

describe('PoliciesService', () => {
  describe('loadSnapshot', () => {
    it('returns the numbers that drive eligibility and every rule, in one call', async () => {
      const { config, rules } = await (await createTestContainer()).policies.loadSnapshot();
      expect(config.returnWindow).toEqual({ days: 30, ruleId: 'R1' });
      expect(config.defectWindow).toEqual({ days: 60, ruleId: 'R2' });
      expect(config.autoApproveLimit).toEqual({ amount: 100, ruleId: 'R5' });
      expect(config.categoryRules.digital).toMatchObject({ verdict: 'escalate', ruleId: 'R3' });
      expect(rules.map((rule) => rule.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'S1', 'S2', 'S3']);
    });

    it('fills {{placeholders}} from the same settings, so each number exists once', async () => {
      const { rules } = await (await createTestContainer()).policies.loadSnapshot();
      const [r1] = pickRules(rules, ['R1']);
      expect(r1?.text).toContain('30 days');
      expect(r1?.text).not.toContain('{{');
      expect(pickRules(rules, ['R5'])[0]?.text).toContain('100.00');
    });

    it('sees an edit on the next load: nothing is cached across tickets', async () => {
      const container = await createTestContainer();
      await container.database('policy_settings').where({ key: 'auto_approve_limit' }).update({ value: 500 });
      await container.database('policy_rules').where({ id: 'R4' }).update({ text: 'Gift cards are never refundable.' });
      const { config, rules } = await container.policies.loadSnapshot();
      expect(config.autoApproveLimit.amount).toBe(500);
      expect(rankRules(rules, 'gift cards')[0]?.rule.id).toBe('R4');
    });

    it('fails clearly when a required setting is missing', async () => {
      const container = await createTestContainer();
      await container.database('policy_settings').where({ key: 'auto_approve_limit' }).del();
      await expect(container.policies.loadSnapshot()).rejects.toMatchObject({
        code: 'POLICY_SETTING_MISSING',
        message: expect.stringContaining('auto_approve_limit'),
      });
    });
  });

  describe('searching the seed rules (golden queries)', () => {
    const rulesPromise = createTestContainer()
      .then((container) => container.policies.loadSnapshot())
      .then((snapshot) => snapshot.rules);
    const top = async (query: string) => rankRules(await rulesPromise, query).map((hit) => hit.rule.id);

    it('finds the seeded rule a customer is asking about', async () => {
      expect((await top('I bought a software license by mistake'))[0]).toBe('R3');
      expect(await top('qwxz plugh')).toEqual([]);
    });
  });

  describe('assertRulesExist', () => {
    it('accepts rules that exist', async () => {
      const { policies } = await createTestContainer();
      await expect(policies.loadSnapshot()).resolves.toBeDefined();
    });

    it('fails fast when the code depends on a rule the database lacks', async () => {
      const container = await createTestContainer();
      await expect(container.verify()).resolves.toBeUndefined();
      await container.database('policy_rules').where({ id: 'S3' }).del(); // nothing references S3, so no constraint is bypassed
      await expect(container.verify()).rejects.toMatchObject({ code: 'POLICY_RULE_MISSING' });
    });
  });
});
