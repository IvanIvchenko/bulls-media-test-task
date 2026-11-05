import { describe, expect, it } from 'vitest';

import { countRows } from '../support/database.js';
import { createTestContainer, createTestServer, run, ticket } from '../support/helpers.js';
import { slowPorts } from '../support/ports.js';

/*
 * The code treats the database as slow and remote. These specs make every storage call take 1-15 ms and
 * check that nothing depended on it being instant.
 */
const slow = { wrapPorts: (ports: Parameters<typeof slowPorts>[0]) => slowPorts(ports, 15) };

describe('against a slow database', () => {
  it('refunds an order once even when several tickets race for it', async () => {
    const container = await createTestContainer(slow);
    const results = await Promise.all(
      ['R-1', 'R-2', 'R-3', 'R-4'].map((ticketId) => run(ticket({ ticketId }), container)),
    );
    expect(results.filter((result) => result.decision === 'approve')).toHaveLength(1);
    expect(await countRows(container.database, 'refunds')).toBe(1);
  });

  it('runs a ticket once when identical requests arrive together over HTTP', async () => {
    const { app, container } = await createTestServer(slow);
    const send = () => app.inject({ method: 'POST', url: '/tickets', payload: ticket() });
    const responses = await Promise.all([send(), send(), send()]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(responses.map((response) => response.json().decision))).toEqual(new Set(['approve']));
    expect(responses.filter((response) => response.headers['idempotent-replay'] === 'true')).toHaveLength(2);
    expect(await countRows(container.database, 'decisions')).toBe(1);
    await app.close();
  });

  it('serves other requests while one is waiting on the database', async () => {
    const { app } = await createTestServer({ wrapPorts: (ports) => slowPorts(ports, 60) });
    const finished: string[] = [];
    const [slowOne, fastOne] = await Promise.all([
      app.inject({ method: 'POST', url: '/tickets', payload: ticket() }).then((response) => {
        finished.push('ticket');
        return response;
      }),
      app.inject({ method: 'GET', url: '/health' }).then((response) => {
        finished.push('health');
        return response;
      }),
    ]);
    expect(slowOne.statusCode).toBe(200);
    expect(fastOne.statusCode).toBe(200);
    expect(finished).toEqual(['health', 'ticket']); // not queued behind the ticket's many storage waits
    await app.close();
  });
});
