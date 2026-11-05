import { ConfigService } from '../config/config.service.js';
import { DEFAULT_SERVER_DATABASE_PATH } from '../config/constants.js';
import { openDatabase } from '../db/database.client.js';

const config = ConfigService.fromEnv();
const path = process.argv[2] ?? config.get('DATABASE_PATH') ?? DEFAULT_SERVER_DATABASE_PATH;
const database = await openDatabase(path); // creates, migrates and seeds it
const count = async (table: string) => Number((await database(table).count('* as n').first())?.n ?? 0);

console.log(
  `Database ready at ${path}: ${await count('orders')} orders, ${await count('policy_rules')} policy rules, ` +
    `${await count('policy_settings')} settings, ${await count('decisions')} audited decisions.`,
);
await database.destroy();
