import { describe, expect, it } from 'vitest';

import { needs } from './needs.util.js';
import type { AgentState } from './typedef.js';

const state = (over: Partial<AgentState>) => ({ ...over }) as AgentState;

describe('needs', () => {
  it('returns the same state when everything asked for is there', () => {
    const present = state({ orderId: 'ORD-1', lookup: 'found' });
    expect(needs(present, 'orderId', 'lookup')).toBe(present);
  });

  it('names every missing field in the error, with a stable code', () => {
    expect(() => needs(state({}), 'ticket', 'classification')).toThrow(
      expect.objectContaining({
        code: 'AGENT_STATE_INVARIANT',
        message: expect.stringMatching(/ticket, classification/),
      }),
    );
  });

  it('treats null like missing, and falsy values like present', () => {
    expect(() => needs(state({ orderId: undefined }), 'orderId')).toThrow();
    expect(() => needs(state({ refundAmount: 0 }), 'refundAmount')).not.toThrow();
    expect(() => needs(state({ reply: '' }), 'reply')).not.toThrow();
  });
});
