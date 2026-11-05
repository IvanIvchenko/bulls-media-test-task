import { MIGRATIONS_TABLE } from './constants.js';
import { MIGRATIONS } from './migrations/migrations.js';
import type { Transaction } from './typedef.js';

/**
 * Apply every migration that has not run yet, in order. Call it inside `withInitLock`, which is what keeps two
 * instances from migrating at once.
 */
export async function migrate(trx: Transaction): Promise<string[]> {
  if (!(await trx.schema.hasTable(MIGRATIONS_TABLE))) {
    await trx.schema.createTable(MIGRATIONS_TABLE, (t) => {
      t.string('name').primary();
      t.timestamp('applied_at', { useTz: true }).notNullable();
    });
  }
  const applied = new Set((await trx(MIGRATIONS_TABLE).select('name')).map((row: { name: string }) => row.name));

  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    await migration.up(trx);
    await trx(MIGRATIONS_TABLE).insert({ name: migration.name, applied_at: new Date().toISOString() });
    ran.push(migration.name);
  }
  return ran;
}
