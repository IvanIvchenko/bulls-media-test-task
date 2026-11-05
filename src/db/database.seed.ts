import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { TABLE } from './constants.js';
import type { OpenOptions, Transaction } from './typedef.js';
import { orderSchema } from '../domain/index.js';

const SEED_DIR = new URL('../../data/seed/', import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, SEED_DIR), 'utf8'));

const policySeedSchema = z.object({
  rules: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
  settings: z.array(z.object({ key: z.string(), value: z.number(), ruleId: z.string() })),
  categoryRules: z.array(
    z.object({
      category: z.enum(['physical', 'digital', 'final_sale']),
      verdict: z.enum(['deny', 'escalate']),
      ruleId: z.string(),
      reason: z.string(),
    }),
  ),
});

const isEmpty = async (trx: Transaction, table: string): Promise<boolean> => {
  const row = await trx(table).count('* as n').first();
  return Number(row?.n ?? 0) === 0;
};

/**
 * Insert seed data into any table that is still empty. Safe to call on every start.
 * Call it inside `withInitLock`: the "is it empty?" check and the inserts then happen while no other instance can
 * start up, so several instances booting together take turns and only the first one seeds.
 */
export async function seedIfEmpty(trx: Transaction, options: OpenOptions = {}): Promise<void> {
  if (await isEmpty(trx, 'policy_rules')) {
    const policy = policySeedSchema.parse(readJson('policy.json'));
    await trx(TABLE.POLICY_RULES).insert(policy.rules);
    await trx(TABLE.POLICY_SETTINGS).insert(
      policy.settings.map((setting) => ({ key: setting.key, value: setting.value, rule_id: setting.ruleId })),
    );
    await trx(TABLE.CATEGORY_RULES).insert(
      policy.categoryRules.map((rule) => ({
        category: rule.category,
        verdict: rule.verdict,
        rule_id: rule.ruleId,
        reason: rule.reason,
      })),
    );
  }

  // Explicit orders (tests) are always inserted. The demo customers only when asked for, never by default in production.
  const wanted = options.orders !== undefined || options.seedSampleOrders !== false;
  if (wanted && (await isEmpty(trx, 'orders'))) {
    const list = options.orders ?? z.array(orderSchema).parse(readJson('orders.json'));
    await trx(TABLE.ORDERS).insert(
      list.map((order) => ({
        order_id: order.orderId,
        customer_email: order.customerEmail,
        item: order.item,
        category: order.category,
        amount: order.amount,
        status: order.status,
        delivered_at: order.deliveredAt,
        refunded: order.refunded,
        tracking_note: order.trackingNote ?? null,
      })),
    );
  }
}
