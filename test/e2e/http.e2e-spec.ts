import { readFileSync, readdirSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { resultSchema } from '../../src/domain/index.js';
import { countRows } from '../support/database.js';
import { createTestServer, ticket } from '../support/helpers.js';

type TestServer = Awaited<ReturnType<typeof createTestServer>>;
const open: TestServer[] = [];
const start = async (overrides: Parameters<typeof createTestServer>[0] = {}): Promise<TestServer> => {
  const server = await createTestServer(overrides);
  open.push(server);
  return server;
};
afterEach(async () => {
  for (const server of open.splice(0)) await server.app.close();
});

const post = (server: TestServer, payload: unknown) =>
  server.app.inject({ method: 'POST', url: '/tickets', payload: payload as object });
const count = (server: TestServer, table: string) => countRows(server.container.database, table);

describe('POST /tickets: happy path', () => {
  it('runs the agent and returns the validated result', async () => {
    const server = await start();
    const res = await post(server, ticket());
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = resultSchema.parse(res.json());
    expect(body).toMatchObject({ ticketId: 'T-1', decision: 'approve', refundAmount: 59.9 });
    expect(await count(server, 'refunds')).toBe(1);
    expect(await count(server, 'decisions')).toBe(1);
  });

  it('marks responses as non-cacheable, since they can contain customer data', async () => {
    const res = await post(await start(), ticket());
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('gives every sample ticket its expected decision over HTTP', async () => {
    const dir = new URL('../../samples/', import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const sample = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      const res = await post(await start(), sample.input);
      expect(res.json().decision, file).toBe(sample.expected.decision);
      expect(res.statusCode, file).toBe(
        sample.expected.decision === 'refuse' && res.json().flags.includes('invalid_input') ? 400 : 200,
      );
    }
  });
});

describe('input handling', () => {
  it('returns 400 with the refusal for an invalid ticket, and never reaches the model', async () => {
    const server = await start();
    const res = await post(server, { ticketId: 'T-9', customerEmail: 'nope', subject: 'x', body: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ decision: 'refuse', flags: ['invalid_input'] });
    expect(res.json().trace.map((t: { step: string }) => t.step)).toEqual(['validate', 'draft_reply']);
  });

  it('returns 400 for malformed JSON without echoing the payload', async () => {
    const res = await (
      await start()
    ).app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { 'content-type': 'application/json' },
      payload: '{"ticketId": "T-1", "customerEmail": "secret@example.com", ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('secret@example.com');
  });

  it('returns 413 for an oversized body', async () => {
    const res = await post(await start(), ticket({ body: 'x'.repeat(40_000) }));
    expect(res.statusCode).toBe(413);
  });

  it('returns 415 for a non-JSON content type', async () => {
    const res = await (
      await start()
    ).app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(res.statusCode).toBe(415);
  });

  it('treats arrays, strings and empty bodies as invalid tickets, not crashes', async () => {
    const server = await start();
    for (const payload of [[1, 2], 'just a string', null]) {
      const res = await server.app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('answers unknown routes with a plain 404', async () => {
    const res = await (await start()).app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('idempotency by ticketId', () => {
  it('replays the stored decision for an identical repeat, without a second refund or audit row', async () => {
    const server = await start();
    const first = await post(server, ticket());
    const second = await post(server, ticket());
    expect(first.json().decision).toBe('approve');
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(await count(server, 'refunds')).toBe(1);
    expect(await count(server, 'decisions')).toBe(1);
  });

  it('treats the same payload with different key order as identical', async () => {
    const server = await start();
    await post(server, ticket());
    const reordered = Object.fromEntries(Object.entries(ticket()).reverse());
    const res = await post(server, reordered);
    expect(res.headers['idempotent-replay']).toBe('true');
  });

  it('returns 409 when a ticketId is reused with a different payload', async () => {
    const server = await start();
    await post(server, ticket());
    const res = await post(server, ticket({ body: 'Something else entirely' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('TICKET_ID_CONFLICT');
    expect(await count(server, 'decisions')).toBe(1);
  });

  it('lets a client fix an invalid payload and reuse the same ticketId', async () => {
    const server = await start();
    expect((await post(server, ticket({ customerEmail: 'not-an-email' }))).statusCode).toBe(400);
    const fixed = await post(server, ticket());
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json().decision).toBe('approve');
  });
});

describe('health and failure handling', () => {
  it('reports ok with the model in use', async () => {
    const res = await (await start()).app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok', llm: 'mock' });
  });

  it('reports 503 when the database is gone', async () => {
    const server = await start();
    await server.container.database.destroy();
    const res = await server.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('returns a generic 500 and leaks no internals when something unexpected breaks', async () => {
    const server = await start();
    await server.container.database.destroy();
    const res = await post(server, ticket());
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
    expect(res.body).not.toMatch(/database|sqlite|stack|at /i);
  });
});
