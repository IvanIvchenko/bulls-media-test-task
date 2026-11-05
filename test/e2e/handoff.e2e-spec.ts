import { describe, expect, it } from 'vitest';

import { createTestContainer, run, ticket } from '../support/helpers.js';

describe('handoff brief for human reviewers', () => {
  it('is present only on escalations', async () => {
    const approved = await run(ticket());
    const denied = await run(ticket({ orderId: 'ORD-1004', customerEmail: 'dan@example.com' }));
    const refused = await run(ticket({ customerEmail: 'mallory@example.com' }));
    expect([approved.handoff, denied.handoff, refused.handoff]).toEqual([null, null, null]);
  });

  it('lists the cited rule with its full text, then search suggestions', async () => {
    const r = await run(
      ticket({
        orderId: 'ORD-1003',
        customerEmail: 'carol@example.com',
        body: 'I bought the software license by mistake and want a refund.',
      }),
    );
    expect(r.decision).toBe('escalate');
    expect(r.handoff?.reasons.join(' ')).toMatch(/Digital goods/);
    const [first, ...rest] = r.handoff!.policies;
    expect(first).toMatchObject({ id: 'R3', source: 'cited' });
    expect(first?.text).toContain('non-refundable');
    expect(rest.every((p) => p.source === 'suggested' && p.id !== 'R3')).toBe(true);
    expect(rest.map((p) => p.id)).not.toContain('R6'); // "refund" alone must not suggest unrelated rules
  });

  it('carries the amount rule for a high-value refund, with the current limit filled in', async () => {
    const r = await run(
      ticket({
        orderId: 'ORD-1002',
        customerEmail: 'ben@example.com',
        body: 'The keyboard is broken, refund please.',
      }),
    );
    const r5 = r.handoff?.policies.find((p) => p.id === 'R5');
    expect(r5).toMatchObject({ source: 'cited' });
    expect(r5?.text).toContain('100.00');
  });

  it('gives out-of-scope tickets the out-of-scope rule', async () => {
    const r = await run(
      ticket({ orderId: undefined, subject: 'Account', body: 'Please update the email on my account.' }),
    );
    expect(r.decision).toBe('escalate');
    expect(r.handoff?.policies.map((p) => p.id)).toContain('S3');
  });

  it('is stored in the audit log with the rest of the result', async () => {
    const container = await createTestContainer();
    await run(
      ticket({ orderId: 'ORD-1002', customerEmail: 'ben@example.com', body: 'Broken, refund please.' }),
      container,
    );
    const row = (await container.database('decisions').first('result_json')) as { result_json: string };
    expect(JSON.parse(row.result_json).handoff.policies.length).toBeGreaterThan(0);
  });
});
