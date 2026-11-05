import { z } from 'zod';

import {
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_CLAIM_POLL_MS,
  DEFAULT_CLAIM_STALE_AFTER_MS,
  DEFAULT_CLAIM_WAIT_MS,
  DEFAULT_HOST,
  DEFAULT_LLM_MAX_RETRIES,
  DEFAULT_LLM_RETRY_BASE_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_MODEL,
  DEFAULT_PORT,
  DEFAULT_REVIEW_STALE_AFTER_MS,
  LOG_LEVELS,
  MODEL_CALLS_PER_REVIEW,
  MODEL_CALLS_PER_TICKET,
} from './constants.js';

/** `VAR=` in a .env file means "unset", not "empty". */
const fromEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** true/false/1/0, so `REQUIRE_LLM=false` means false and not "a non-empty string". */
const flag = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

/** Flat schema: keys are the environment variable names. */
const environmentSchema = z.object({
  /** "production" turns the safe defaults on (see REQUIRE_LLM and SEED_SAMPLE_ORDERS). */
  NODE_ENV: fromEnv(z.string().trim().default('development')),

  LOG_LEVEL: fromEnv(z.enum(LOG_LEVELS).default('info')),

  /** Empty means "no key": the agent runs on the deterministic mock model, unless REQUIRE_LLM is on. */
  ANTHROPIC_API_KEY: fromEnv(z.string().trim().optional()),
  /** Refuse to start without a key instead of silently using the keyword mock. Defaults to on in production. */
  REQUIRE_LLM: fromEnv(flag.optional()),
  ANTHROPIC_MODEL: fromEnv(z.string().trim().default(DEFAULT_MODEL)),
  /** Per-attempt timeout for a model call. Without one, a hung call would hang the request. */
  LLM_TIMEOUT_MS: fromEnv(z.coerce.number().int().positive().default(DEFAULT_LLM_TIMEOUT_MS)),
  LLM_MAX_RETRIES: fromEnv(z.coerce.number().int().min(0).default(DEFAULT_LLM_MAX_RETRIES)),
  LLM_RETRY_BASE_MS: fromEnv(z.coerce.number().int().min(0).default(DEFAULT_LLM_RETRY_BASE_MS)),

  /** The SQLite file. Unset means a default that depends on who is asking: in-memory for the CLI, a file for the service. */
  DATABASE_PATH: fromEnv(z.string().trim().optional()),
  /** Fill an empty orders table with the demo customers. Defaults to off in production, where it would be fake data. */
  SEED_SAMPLE_ORDERS: fromEnv(flag.optional()),

  /** Turns on human review of escalations and protects its routes. At least 16 characters. Unset means no review. */
  REVIEW_TOKEN: fromEnv(z.string().trim().min(16).optional()),
  /** Like CLAIM_STALE_AFTER_MS, for a review being answered: after this long another caller may take it over. */
  REVIEW_STALE_AFTER_MS: fromEnv(z.coerce.number().int().positive().default(DEFAULT_REVIEW_STALE_AFTER_MS)),

  HOST: fromEnv(z.string().trim().default(DEFAULT_HOST)),
  PORT: fromEnv(z.coerce.number().int().positive().default(DEFAULT_PORT)),
  BODY_LIMIT_BYTES: fromEnv(z.coerce.number().int().positive().default(DEFAULT_BODY_LIMIT_BYTES)),

  /** Idempotency by ticket id, shared by every instance through the database. */
  CLAIM_STALE_AFTER_MS: fromEnv(z.coerce.number().int().positive().default(DEFAULT_CLAIM_STALE_AFTER_MS)),
  CLAIM_WAIT_MS: fromEnv(z.coerce.number().int().min(0).default(DEFAULT_CLAIM_WAIT_MS)),
  CLAIM_POLL_MS: fromEnv(z.coerce.number().int().positive().default(DEFAULT_CLAIM_POLL_MS)),
});

export const configSchema = environmentSchema
  .superRefine((env, context) => {
    // If a live ticket can outlast its claim, another instance takes it over and runs the model a second time.
    const worstCaseMs = MODEL_CALLS_PER_TICKET * (env.LLM_MAX_RETRIES + 1) * env.LLM_TIMEOUT_MS;
    if (env.CLAIM_STALE_AFTER_MS <= worstCaseMs) {
      context.addIssue({
        code: 'custom',
        path: ['CLAIM_STALE_AFTER_MS'],
        message:
          `must be longer than the worst-case model time of ${worstCaseMs} ms ` +
          `(${MODEL_CALLS_PER_TICKET} calls x ${env.LLM_MAX_RETRIES + 1} attempts x ${env.LLM_TIMEOUT_MS} ms timeout)`,
      });
    }
    const reviewWorstCaseMs = MODEL_CALLS_PER_REVIEW * (env.LLM_MAX_RETRIES + 1) * env.LLM_TIMEOUT_MS;
    if (env.REVIEW_STALE_AFTER_MS <= reviewWorstCaseMs) {
      context.addIssue({
        code: 'custom',
        path: ['REVIEW_STALE_AFTER_MS'],
        message: `must be longer than the worst-case time to answer a review of ${reviewWorstCaseMs} ms`,
      });
    }
  })
  .transform((env) => {
    const production = env.NODE_ENV === 'production';
    return {
      ...env,
      REQUIRE_LLM: env.REQUIRE_LLM ?? production,
      SEED_SAMPLE_ORDERS: env.SEED_SAMPLE_ORDERS ?? !production,
    };
  });

export type Config = z.infer<typeof configSchema>;
