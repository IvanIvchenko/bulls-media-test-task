import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Logger } from '../../src/shared/logger/logger.js';
import { createTestServer, ticket } from '../support/helpers.js';
import { slowPorts } from '../support/ports.js';

/** Capture what the service logs, as parsed JSON lines. */
let lines: string[];
beforeEach(() => {
  lines = [];
  Logger.configure('info', { write: (chunk: string) => void lines.push(chunk) });
});
afterEach(() => Logger.configure('silent'));

const logged = () => lines.flatMap((line) => line.split('\n').filter(Boolean)).map((line) => JSON.parse(line));
const agentLogs = (ticketId: string) => logged().filter((entry) => entry.context && entry.ticketId === ticketId);

const post = (app: Awaited<ReturnType<typeof createTestServer>>['app'], payload: object, requestId?: string) =>
  app.inject({ method: 'POST', url: '/tickets', payload, headers: requestId ? { 'x-request-id': requestId } : {} });

describe('request correlation', () => {
  it("puts the caller's request id on the response and on every log line the request produces", async () => {
    const { app } = await createTestServer();
    const response = await post(app, ticket(), 'abc-123');

    expect(response.headers['x-request-id']).toBe('abc-123');
    const entries = agentLogs('T-1');
    expect(entries.length).toBeGreaterThan(8); // every step plus the decision
    expect(new Set(entries.map((entry) => entry.requestId))).toEqual(new Set(['abc-123']));
    await app.close();
  });

  it('makes up an id when the caller sends none, and uses it everywhere', async () => {
    const { app } = await createTestServer();
    const response = await post(app, ticket());

    const id = String(response.headers['x-request-id']);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(agentLogs('T-1').map((entry) => entry.requestId))).toEqual(new Set([id]));
    await app.close();
  });

  it.each(['has spaces', 'semi;colon', 'x'.repeat(65), '<script>', 'new\\nline'])(
    'replaces an id that is not short and plain: %j',
    async (unsafe) => {
      const { app } = await createTestServer();
      const response = await post(app, ticket(), unsafe);
      expect(response.headers['x-request-id']).not.toBe(unsafe);
      expect(String(response.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
      await app.close();
    },
  );

  it('keeps concurrent requests apart: each log line names its own request, never a neighbour', async () => {
    const { app } = await createTestServer({ wrapPorts: (ports) => slowPorts(ports, 15) }); // forces interleaving
    const one = ticket({ ticketId: 'T-A' });
    const two = ticket({ ticketId: 'T-B', orderId: 'ORD-1002', customerEmail: 'ben@example.com' });
    await Promise.all([post(app, one, 'req-A'), post(app, two, 'req-B')]);

    expect(new Set(agentLogs('T-A').map((entry) => entry.requestId))).toEqual(new Set(['req-A']));
    expect(new Set(agentLogs('T-B').map((entry) => entry.requestId))).toEqual(new Set(['req-B']));
    await app.close();
  });
});
