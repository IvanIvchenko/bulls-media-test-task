import { z } from 'zod';

import {
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_HOST,
  DEFAULT_LLM_MAX_RETRIES,
  DEFAULT_LLM_RETRY_BASE_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_MODEL,
  DEFAULT_PORT,
  LOG_LEVELS,
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

  HOST: fromEnv(z.string().trim().default(DEFAULT_HOST)),
  PORT: fromEnv(z.coerce.number().int().positive().default(DEFAULT_PORT)),
  BODY_LIMIT_BYTES: fromEnv(z.coerce.number().int().positive().default(DEFAULT_BODY_LIMIT_BYTES)),
});

export const configSchema = environmentSchema.transform((env) => {
  const production = env.NODE_ENV === 'production';
  return {
    ...env,
    REQUIRE_LLM: env.REQUIRE_LLM ?? production,
    SEED_SAMPLE_ORDERS: env.SEED_SAMPLE_ORDERS ?? !production,
  };
});

export type Config = z.infer<typeof configSchema>;
