import type { PoliciesMapper } from './policies.mapper.js';
import type { PoliciesRepository } from './policies.repository.js';
import type { PolicySnapshot, PolicyTools } from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

export class PoliciesService implements PolicyTools {
  public constructor(
    private readonly repository: PoliciesRepository,
    private readonly mapper: PoliciesMapper,
  ) {}

  /**
   * Everything one ticket needs from the policy, in one round of reads that run together. The agent loads it
   * once and works from memory, so a slow or remote database costs one wait per ticket, not one per lookup.
   */
  public async loadSnapshot(): Promise<PolicySnapshot> {
    const [settings, categoryRules, rules] = await Promise.all([
      this.repository.findSettings(),
      this.repository.findCategoryRules(),
      this.repository.findRules(),
    ]);
    return { config: this.mapper.toConfig(settings, categoryRules), rules: this.mapper.toRules(rules, settings) };
  }

  /** Fail fast at startup if the code refers to a rule id the database does not have, or a setting is missing. */
  public async assertRulesExist(ids: readonly string[]): Promise<void> {
    const { rules } = await this.loadSnapshot(); // also validates the required settings
    const known = new Set(rules.map((rule) => rule.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new BusinessLogicError(
        `policy_rules is missing rule(s) the code depends on: ${missing.join(', ')}`,
        ErrorCodes.POLICY_RULE_MISSING,
      );
    }
  }
}
