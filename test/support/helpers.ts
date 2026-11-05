import { openTestDatabase } from './database.js';
import { ConfigService } from '../../src/config/config.service.js';
import { createContainer, createPorts, type Container, type Ports } from '../../src/container.js';
import type { Database } from '../../src/db/typedef.js';
import type { Order } from '../../src/domain/index.js';
import { MockLlmService } from '../../src/llm/mock.service.js';
import type { LLM } from '../../src/llm/typedef.js';
import { buildServer } from '../../src/server.js';

export const NOW = new Date('2026-11-04');

export interface TestContainerOptions {
  /** Seed these orders instead of the sample ones. */
  orders?: Order[];
  /** Swap the model, e.g. for one that fails or misbehaves. Defaults to the deterministic mock. */
  llm?: LLM;
  /** Config overrides, as environment variables. */
  env?: Record<string, string>;
  /** Wrap or replace the storage ports, e.g. to add latency or count calls. */
  wrapPorts?: (ports: Ports) => Ports;
  /** Use this database instead of a fresh in-memory one, e.g. a file shared by two instances. */
  database?: Database;
  /** Clock. Defaults to a fixed date. */
  now?: () => Date;
}

/** Everything wired on a fresh, isolated in-memory database, with a fixed clock and the mock model. */
export async function createTestContainer(options: TestContainerOptions = {}): Promise<Container> {
  const database = options.database ?? (await openTestDatabase({ orders: options.orders }));
  return createContainer({
    // Short waits: a duplicate polls every few ms instead of every 200 ms.
    // Short waits, and a model that cannot take long, so the short claim windows tests use stay valid.
    config: ConfigService.fromObject({
      LLM_TIMEOUT_MS: '1000',
      LLM_MAX_RETRIES: '0',
      CLAIM_POLL_MS: '5',
      CLAIM_WAIT_MS: '3000',
      ...options.env,
    }),
    database,
    llm: options.llm ?? new MockLlmService(),
    now: options.now ?? (() => NOW),
    ports: options.wrapPorts?.(createPorts(database)),
  });
}

/** Make a claim look as if its owner made it `ageMs` ago, by the database's clock. */
export async function backdateClaim(database: Container['database'], claimKey: string, ageMs: number) {
  const claimedAt = new Date(Date.now() - ageMs).toISOString().slice(0, 19).replace('T', ' ');
  await database('ticket_claims').where({ ticket_id: claimKey }).update({ claimed_at: claimedAt });
}

/** Run one raw ticket through the agent. */
export const run = async (raw: unknown, container?: Container) =>
  (container ?? (await createTestContainer())).agent.run(raw);

export const ticket = (over: Record<string, unknown> = {}) => ({
  ticketId: 'T-1',
  customerEmail: 'anna@example.com',
  orderId: 'ORD-1001',
  subject: 'Refund',
  body: 'I want my money back for the headphones.',
  ...over,
});

/** A real Fastify server on a fresh in-memory database, driven in-process with `app.inject`. */
export async function createTestServer(options: TestContainerOptions = {}) {
  const container = await createTestContainer(options);
  return { app: buildServer(container), container };
}
