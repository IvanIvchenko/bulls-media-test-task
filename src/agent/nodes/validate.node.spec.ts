import { describe, expect, it } from 'vitest';

import { ValidateNode } from './validate.node.js';
import { stateWith, ticket } from '../../../test/support/nodes.js';

describe('ValidateNode', () => {
  it('stores the parsed ticket for a valid request', async () => {
    const update = await new ValidateNode().execute(stateWith({ raw: { ...ticket, subject: '  Refund  ' } }));
    expect(update.ticket).toMatchObject({ ticketId: 'T-1', subject: 'Refund' }); // trimmed
    expect(update.trace?.[0]).toMatchObject({ step: 'validate', ok: true });
  });

  it('refuses an invalid request, listing what is wrong and flagging it', async () => {
    const update = await new ValidateNode().execute(stateWith({ raw: { ticketId: 'bad id', customerEmail: 'nope' } }));
    expect(update).toMatchObject({ decision: 'refuse', flags: ['invalid_input'] });
    expect(update.ticket).toBeUndefined();
    expect(update.reasons?.length).toBeGreaterThan(2);
  });
});
