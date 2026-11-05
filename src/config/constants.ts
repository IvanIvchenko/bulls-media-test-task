export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;
export const DEFAULT_LLM_MAX_RETRIES = 2;
/** First retry waits about this long; each further retry doubles it, with jitter. */
export const DEFAULT_LLM_RETRY_BASE_MS = 200;
/** A ticket makes two model calls: classification, then the reply. */
export const MODEL_CALLS_PER_TICKET = 2;
export const DEFAULT_PORT = 3000;
/** Loopback by default; set HOST=0.0.0.0 deliberately to expose the service. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024;

/** A claim whose owner has not finished after this long is presumed dead and may be taken over. */
export const DEFAULT_CLAIM_STALE_AFTER_MS = 180_000;
/** How long a duplicate request waits for the ticket's owner before asking the client to retry. */
export const DEFAULT_CLAIM_WAIT_MS = 30_000;
export const DEFAULT_CLAIM_POLL_MS = 200;

/** A review whose decider has not finished after this long is presumed dead and may be taken over. */
export const DEFAULT_REVIEW_STALE_AFTER_MS = 180_000;
/** Answering a review makes one model call (the redrafted reply). */
export const MODEL_CALLS_PER_REVIEW = 1;

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const DEFAULT_SERVER_DATABASE_PATH = 'data/store.db';
