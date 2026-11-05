import { readdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { ConfigService } from '../config/config.service.js';
import { createContainer } from '../container.js';
import { openDatabase } from '../db/database.client.js';
import type { Result } from '../domain/index.js';
import { createLlm } from '../llm/llm.factory.js';
import { Logger } from '../shared/logger/logger.js';

const SAMPLES_CLOCK = '2026-11-04';

const { values } = parseArgs({
  options: {
    file: { type: 'string', short: 'f' },
    samples: { type: 'boolean' },
    now: { type: 'string' }, // fixed clock for reproducible runs
    db: { type: 'string' }, // SQLite file to use (default: DATABASE_PATH, else a fresh in-memory database)
    json: { type: 'boolean' },
  },
});

const config = ConfigService.fromEnv();
Logger.configure(config.get('LOG_LEVEL'));
const llm = createLlm(config);
const now = new Date(values.now ?? (values.samples ? SAMPLES_CLOCK : Date.now()));
const newContainer = async (databasePath: string) =>
  createContainer({
    config,
    database: await openDatabase(databasePath, { seedSampleOrders: config.get('SEED_SAMPLE_ORDERS') }),
    llm,
    now: () => now,
  });

/** Samples mode gives every ticket a fresh in-memory database so runs are independent. Otherwise one is shared. */
const sharedContainer = values.samples
  ? undefined
  : await newContainer(values.db ?? config.get('DATABASE_PATH') ?? ':memory:');
await sharedContainer?.verify();

async function run(raw: unknown): Promise<Result> {
  if (sharedContainer) return sharedContainer.agent.run(raw);
  const container = await newContainer(':memory:');
  try {
    await container.verify();
    return await container.agent.run(raw);
  } finally {
    await container.close();
  }
}

function print(result: Result) {
  if (values.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`\n=== ${result.summary}\nReply: ${result.reply}`);
  console.log(JSON.stringify({ ...result, trace: `(${result.trace.length} steps, use --json to see)` }, null, 2));
}

async function runSamples(): Promise<number> {
  const dir = new URL('../../samples/', import.meta.url);
  let failed = 0;
  for (const fileName of readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const sample = JSON.parse(readFileSync(new URL(fileName, dir), 'utf8'));
    const result = await run(sample.input);
    const passed = result.decision === sample.expected.decision;
    if (!passed) failed++;
    console.log(
      `${passed ? 'PASS' : 'FAIL'}  ${fileName.padEnd(40)} expected=${sample.expected.decision} got=${result.decision}  [${result.flags.join(',')}]`,
    );
  }
  return failed;
}

if (values.samples) {
  process.exit((await runSamples()) ? 1 : 0);
} else if (values.file) {
  const parsed = JSON.parse(readFileSync(values.file, 'utf8'));
  print(await run(parsed?.input ?? parsed)); // accepts a sample file or a bare ticket
  await sharedContainer?.close(); // otherwise the connection pool keeps the process alive
} else {
  console.error(
    'Usage: npm start -- --file samples/01-refund-approved.json [--json] [--db data/store.db]\n       npm run samples',
  );
  process.exit(2);
}
