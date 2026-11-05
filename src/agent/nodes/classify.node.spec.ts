import { describe, expect, it } from 'vitest';

import { ClassifyNode } from './classify.node.js';
import { classification, fakeLlm, stateWith, ticket } from '../../../test/support/nodes.js';

describe('ClassifyNode', () => {
  it('stores the classification', async () => {
    const update = await new ClassifyNode(fakeLlm()).execute(stateWith({ ticket }));
    expect(update.classification).toEqual(classification);
    expect(update.trace?.[0]).toMatchObject({ step: 'classify', tool: 'fake', ok: true });
  });

  it('flags a failure instead of throwing, and keeps the error text out of the trace', async () => {
    const failing = fakeLlm({
      classify: async () => {
        throw new Error('secret anna@example.com');
      },
    });
    const update = await new ClassifyNode(failing).execute(stateWith({ ticket }));
    expect(update.flags).toEqual(['classifier_failed']);
    expect(update.classification).toBeUndefined();
    expect(JSON.stringify(update.trace)).not.toMatch(/secret|anna@/);
  });
});
