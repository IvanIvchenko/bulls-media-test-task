import type { Database, Migration, Transaction } from '../typedef.js';

const CATEGORIES = ['physical', 'digital', 'final_sale'];
const ORDER_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled'];
const VERDICTS = ['deny', 'escalate'];
const CLAIM_STATUSES = ['in_progress', 'done'];

/** `value IN (?, ?, ...)` with the allowed values bound. */
const oneOf = (column: string, values: string[]) =>
  [`?? in (${values.map(() => '?').join(', ')})`, [column, ...values]] as const;

/**
 * The whole schema, written with Knex's schema builder rather than SQL text, so it is not tied to one database. CHECK, UNIQUE and
 * FOREIGN KEY constraints make the database enforce the invariants, not only the code. Every table is created
 * only if missing, so a database made by an earlier version of the app is adopted, not rebuilt.
 */
export const initialSchema: Migration = {
  name: '001-initial-schema',

  async up(database: Database | Transaction): Promise<void> {
    // `database.schema` is a builder that accumulates statements, so take a fresh one for every call.
    const create = async (name: string, build: Parameters<Database['schema']['createTable']>[1]) => {
      if (!(await database.schema.hasTable(name))) await database.schema.createTable(name, build);
    };

    await create('orders', (t) => {
      t.string('order_id').primary();
      t.string('customer_email').notNullable();
      t.string('item').notNullable();
      t.string('category').notNullable();
      t.decimal('amount', 12, 2).notNullable();
      t.string('status').notNullable();
      t.date('delivered_at');
      t.boolean('refunded').notNullable().defaultTo(false);
      t.text('tracking_note');
      t.check(...oneOf('category', CATEGORIES), 'orders_category_check');
      t.check(...oneOf('status', ORDER_STATUSES), 'orders_status_check');
      t.check('?? >= 0', ['amount'], 'orders_amount_check');
    });

    await create('policy_rules', (t) => {
      t.string('id').primary();
      t.string('title').notNullable();
      t.text('text').notNullable();
    });

    await create('policy_settings', (t) => {
      t.string('key').primary();
      t.decimal('value', 12, 2).notNullable();
      t.string('rule_id').notNullable().references('id').inTable('policy_rules');
    });

    await create('category_rules', (t) => {
      t.string('category').primary();
      t.string('verdict').notNullable();
      t.string('rule_id').notNullable().references('id').inTable('policy_rules');
      t.text('reason').notNullable();
      t.check(...oneOf('category', CATEGORIES), 'category_rules_category_check');
      t.check(...oneOf('verdict', VERDICTS), 'category_rules_verdict_check');
    });

    // UNIQUE (order_id): the database itself refuses a second refund for the same order.
    await create('refunds', (t) => {
      t.increments('id');
      t.string('order_id').notNullable().unique().references('order_id').inTable('orders');
      t.string('ticket_id').notNullable();
      t.decimal('amount', 12, 2).notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable();
    });

    // Append-only audit trail: one row per agent decision.
    await create('decisions', (t) => {
      t.increments('id');
      t.string('ticket_id').notNullable().index('idx_decisions_ticket');
      t.string('decision').notNullable();
      t.decimal('refund_amount', 12, 2).notNullable();
      t.text('flags').notNullable();
      t.text('summary').notNullable();
      t.text('result_json').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable();
    });

    // Who is processing which ticket. The primary key is the referee: the database lets exactly one caller insert
    // a given id, whichever process it runs in. owner_token fences a presumed-dead owner out.
    await create('ticket_claims', (t) => {
      t.string('ticket_id').primary();
      t.string('request_hash').notNullable();
      t.string('status').notNullable();
      t.string('owner_token').notNullable();
      t.text('result_json');
      t.timestamp('claimed_at', { useTz: true }).notNullable();
      t.check(...oneOf('status', CLAIM_STATUSES), 'ticket_claims_status_check');
    });
  },
};
