/** How long a SQLite connection waits for another process's write lock before giving up. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export const MIGRATIONS_TABLE = 'schema_migrations';
export const INIT_LOCK_TABLE = 'app_init_lock';

export const SQLITE_MEMORY = ':memory:';

/** Application tables, so a typo is a compile error. The migration keeps its own literals: it records the schema as shipped. */
export const TABLE = {
  ORDERS: 'orders',
  REFUNDS: 'refunds',
  DECISIONS: 'decisions',
  TICKET_CLAIMS: 'ticket_claims',
  POLICY_RULES: 'policy_rules',
  POLICY_SETTINGS: 'policy_settings',
  CATEGORY_RULES: 'category_rules',
} as const;
