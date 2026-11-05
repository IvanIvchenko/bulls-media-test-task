import { configSchema, type Config } from './configuration.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

/** Validated configuration, read through typed keys. Services never touch `process.env`. */
export class ConfigService {
  public constructor(private readonly values: Config) {}

  /** Validate raw environment variables. Throws one readable error listing every problem. */
  public static fromObject(env: Record<string, string | undefined>): ConfigService {
    const parsed = configSchema.safeParse(env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new BusinessLogicError(`Invalid configuration: ${problems.join('; ')}`, ErrorCodes.INVALID_CONFIGURATION);
    }
    return new ConfigService(parsed.data);
  }

  /** Load `.env` if there is one (real environment variables win), then validate `process.env`. */
  public static fromEnv(): ConfigService {
    try {
      process.loadEnvFile();
    } catch {
      /* no .env file */
    }
    return ConfigService.fromObject(process.env);
  }

  public get<K extends keyof Config>(key: K): Config[K] {
    return this.values[key];
  }

  public getOrThrow<K extends keyof Config>(key: K): NonNullable<Config[K]> {
    const value = this.values[key];
    if (value === undefined || value === null || value === '') {
      throw new BusinessLogicError(`Missing required configuration: ${key}`, ErrorCodes.MISSING_CONFIGURATION);
    }
    return value as NonNullable<Config[K]>;
  }
}
