import type { Database, Migration, Transaction } from '../typedef.js';

const REVIEW_STATUSES = ['pending', 'deciding', 'resolved'];

type Handle = Database | Transaction;

/**
 * Runs paused for a human. `pending_reviews` has one row per escalation a reviewer can settle (what the reviewer sees,
 * and which graph thread to resume). `graph_checkpoints` and `graph_writes` are LangGraph's saved state for those
 * threads, written by `KnexCheckpointSaver` and deleted when the review is answered. Each table is created only if
 * it is missing, like the first migration.
 */
export const pendingReviews: Migration = {
  name: '003-pending-reviews',

  async up(database: Handle): Promise<void> {
    if (!(await database.schema.hasTable('pending_reviews'))) await createPendingReviews(database);
    if (!(await database.schema.hasTable('graph_checkpoints'))) await createGraphCheckpoints(database);
    if (!(await database.schema.hasTable('graph_writes'))) await createGraphWrites(database);
  },
};

async function createPendingReviews(database: Handle): Promise<void> {
  await database.schema.createTable('pending_reviews', (t) => {
    t.string('review_id').primary();
    t.string('ticket_id').notNullable();
    t.string('thread_id').notNullable();
    t.string('status').notNullable();
    t.text('request_json').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(database.fn.now());
    t.timestamp('resolved_at', { useTz: true });
    t.string('decider_token');
    t.timestamp('deciding_since', { useTz: true });
    t.string('decision');
    t.string('reviewer');
    t.text('note');
    t.index(['status'], 'idx_pending_reviews_status');
    t.check(
      `?? in (${REVIEW_STATUSES.map(() => '?').join(', ')})`,
      ['status', ...REVIEW_STATUSES],
      'pending_reviews_status_check',
    );
  });
}

async function createGraphCheckpoints(database: Handle): Promise<void> {
  await database.schema.createTable('graph_checkpoints', (t) => {
    t.string('thread_id').notNullable();
    t.string('checkpoint_ns').notNullable().defaultTo('');
    t.string('checkpoint_id').notNullable();
    t.string('parent_checkpoint_id');
    t.string('checkpoint_type').notNullable();
    t.string('metadata_type').notNullable();
    t.binary('checkpoint').notNullable();
    t.binary('metadata').notNullable();
    t.primary(['thread_id', 'checkpoint_ns', 'checkpoint_id']);
  });
}

async function createGraphWrites(database: Handle): Promise<void> {
  await database.schema.createTable('graph_writes', (t) => {
    t.string('thread_id').notNullable();
    t.string('checkpoint_ns').notNullable().defaultTo('');
    t.string('checkpoint_id').notNullable();
    t.string('task_id').notNullable();
    t.integer('idx').notNullable();
    t.string('channel').notNullable();
    t.string('value_type').notNullable();
    t.binary('value').notNullable();
    t.string('task_path').notNullable().defaultTo('');
    t.primary(['thread_id', 'checkpoint_ns', 'checkpoint_id', 'task_id', 'idx']);
  });
}
