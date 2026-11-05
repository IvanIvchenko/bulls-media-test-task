import { parseArgs } from 'node:util';

import { ConfigService } from '../config/config.service.js';
import { DEFAULT_SERVER_DATABASE_PATH } from '../config/constants.js';
import { openDatabase } from '../db/database.client.js';
import { RetentionRepository } from '../retention/retention.repository.js';
import { RetentionService } from '../retention/retention.service.js';

const { values } = parseArgs({ options: { days: { type: 'string' }, db: { type: 'string' } } });
const days = Number(values.days);
if (!values.days || !Number.isFinite(days) || days <= 0) {
  console.error(
    'Usage: npm run db:prune -- --days 90 [--db data/store.db]\n(no default: deleting data should be a decision)',
  );
  process.exit(2);
}

const config = ConfigService.fromEnv();
const path = values.db ?? config.get('DATABASE_PATH') ?? DEFAULT_SERVER_DATABASE_PATH;
const database = await openDatabase(path, { seedSampleOrders: false });
const result = await new RetentionService(new RetentionRepository(database), () => new Date()).prune(days);
console.log(
  `Pruned ${path}: ${result.decisions} audit rows, ${result.claims} finished claims and ${result.reviews} answered reviews older than ${days} days.`,
);
await database.destroy();
