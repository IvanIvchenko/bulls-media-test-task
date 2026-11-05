/** How long a SQLite connection waits for another process's write lock before giving up. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export const MIGRATIONS_TABLE = 'schema_migrations';

export const SQLITE_MEMORY = ':memory:';

/** Application tables, so a typo is a compile error. The migration keeps its own literals: it records the schema as shipped. */
export const TABLE = {
  ORDERS: 'orders',
  REFUNDS: 'refunds',
  DECISIONS: 'decisions',
  POLICY_RULES: 'policy_rules',
  POLICY_SETTINGS: 'policy_settings',
  CATEGORY_RULES: 'category_rules',
  PENDING_REVIEWS: 'pending_reviews',
  GRAPH_CHECKPOINTS: 'graph_checkpoints',
  GRAPH_WRITES: 'graph_writes',
} as const;
