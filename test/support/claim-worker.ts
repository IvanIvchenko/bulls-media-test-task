/*
 * A separate OS process that opens the shared database and processes one ticket, then prints the outcome as
 * JSON. Spawned by the multi-process e2e spec.   usage: claim-worker.ts <database path> <ticket json>
 */
import { createTestContainer } from './helpers.js';
import { slowPorts } from './ports.js';
import { openDatabase } from '../../src/db/database.client.js';
import { Logger } from '../../src/shared/logger/logger.js';

Logger.configure('silent');
const [, , databasePath, ticketJson] = process.argv;

// Slow ports stretch the agent run, so the processes genuinely overlap.
const container = await createTestContainer({
  // A claim older than this counts as abandoned (set by the takeover spec).
  env: process.env.CLAIM_STALE_AFTER_MS ? { CLAIM_STALE_AFTER_MS: process.env.CLAIM_STALE_AFTER_MS } : {},
  database: await openDatabase(databasePath!),
  wrapPorts: (ports) => slowPorts(ports, 40),
});
const outcome = await container.tickets.process(JSON.parse(ticketJson!));
console.log(JSON.stringify({ kind: outcome.kind, decision: outcome.result.decision }));
await container.close();
