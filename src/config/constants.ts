export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;
export const DEFAULT_LLM_MAX_RETRIES = 2;
/** First retry waits about this long; each further retry doubles it, with jitter. */
export const DEFAULT_LLM_RETRY_BASE_MS = 200;
export const DEFAULT_PORT = 3000;
/** Loopback by default; set HOST=0.0.0.0 deliberately to expose the service. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024;

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const DEFAULT_SERVER_DATABASE_PATH = 'data/store.db';
