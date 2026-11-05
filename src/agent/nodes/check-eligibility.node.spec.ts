import { describe, expect, it } from 'vitest';

import { CheckEligibilityNode } from './check-eligibility.node.js';
import { NOW } from '../../../test/support/helpers.js';
import { classification, order, snapshot, stateWith } from '../../../test/support/nodes.js';
import type { PolicySnapshot } from '../../domain/index.js';

describe('CheckEligibilityNode', () => {
  const eligibilityState = stateWith({ order, classification, policies: snapshot });

  it('applies the loaded policy as of the clock', async () => {
    const early = await new CheckEligibilityNode(() => NOW).execute(eligibilityState);
    expect(early.eligibility?.verdict).toBe('approve');

    const late = await new CheckEligibilityNode(() => new Date('2027-03-01')).execute(eligibilityState);
    expect(late.eligibility?.verdict).toBe('deny'); // the same order, months later
  });

  it('uses the snapshot it was given, not whatever the database says now', async () => {
    const stricter: PolicySnapshot = {
      ...snapshot,
      config: { ...snapshot.config, autoApproveLimit: { amount: 10, ruleId: 'R5' } },
    };
    const update = await new CheckEligibilityNode(() => NOW).execute({ ...eligibilityState, policies: stricter });
    expect(update.eligibility?.verdict).toBe('escalate');
  });
});
