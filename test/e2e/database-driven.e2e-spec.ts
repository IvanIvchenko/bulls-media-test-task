import { describe, expect, it } from 'vitest';

import { createTestContainer, run, ticket } from '../support/helpers.js';

describe('database-driven behaviour', () => {
  const bigTicket = ticket({
    orderId: 'ORD-1002',
    customerEmail: 'ben@example.com',
    body: 'The keyboard arrived broken. I want a refund.',
  });

  it('editing a policy row changes the decision with no code change', async () => {
    const container = await createTestContainer();
    expect((await run(bigTicket, container)).decision).toBe('escalate'); // 149 > 100
    await container.database('policy_settings').where({ key: 'auto_approve_limit' }).update({ value: 500 });
    const after = await run({ ...bigTicket, ticketId: 'T-2' }, container);
    expect(after.decision).toBe('approve');
    expect(after.refundAmount).toBe(149);
  });

  it('every run is written to the audit log, including refusals and invalid input', async () => {
    const container = await createTestContainer();
    await run(ticket(), container);
    await run(ticket({ ticketId: 'T-2', customerEmail: 'mallory@example.com' }), container);
    await run({ nope: true }, container);
    const rows = await container.database('decisions').select('ticket_id', 'decision').orderBy('id');
    expect(rows).toEqual([
      { ticket_id: 'T-1', decision: 'approve' },
      { ticket_id: 'T-2', decision: 'refuse' },
      { ticket_id: 'unknown', decision: 'refuse' },
    ]);
    const stored = (await container.database('decisions').where({ ticket_id: 'T-1' }).first('result_json')) as {
      result_json: string;
    };
    expect(JSON.parse(stored.result_json)).toMatchObject({ decision: 'approve', refundAmount: 59.9 });
  });

  it('a failing audit write does not lose the decision; it is flagged', async () => {
    const container = await createTestContainer();
    await container.database.schema.dropTable('decisions');
    const r = await run(ticket(), container);
    expect(r.decision).toBe('approve');
    expect(r.flags).toContain('audit_failed');
  });

  it('a denial quotes the cited policy text to the customer', async () => {
    const r = await run(
      ticket({ orderId: 'ORD-1004', customerEmail: 'dan@example.com', body: 'Refund the lamp, I changed my mind.' }),
    );
    expect(r.decision).toBe('deny');
    expect(r.reply).toContain('R1 Return window');
    expect(r.reply).toContain('30 days');
    expect(r.trace.find((t) => t.step === 'cite_policies')).toMatchObject({ tool: 'getPolicyRules', ok: true });
  });

  it('never quotes policy text to an unverified requester', async () => {
    const r = await run(ticket({ customerEmail: 'mallory@example.com' }));
    expect(r.decision).toBe('refuse');
    expect(r.reply).not.toMatch(/R\d|Return window|policy/i);
    expect(r.trace.find((t) => t.step === 'cite_policies')).toMatchObject({ detail: 'nothing to cite' });
  });
});
