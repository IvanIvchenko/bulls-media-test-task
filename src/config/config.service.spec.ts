import { describe, expect, it } from 'vitest';

import { ConfigService } from './config.service.js';

describe('ConfigService', () => {
  it('applies defaults for everything that is unset', () => {
    const config = ConfigService.fromObject({});
    expect(config.get('LOG_LEVEL')).toBe('info');
    expect(config.get('ANTHROPIC_MODEL')).toBe('claude-haiku-5-5');
    expect(config.get('LLM_TIMEOUT_MS')).toBe(20_000);
    expect(config.get('LLM_MAX_RETRIES')).toBe(2);
    expect(config.get('HOST')).toBe('127.0.0.1');
    expect(config.get('PORT')).toBe(3000);
    expect(config.get('BODY_LIMIT_BYTES')).toBe(16 * 1024);
  });

  it('leaves the key and the database path unset: the CLI and the service pick different defaults', () => {
    const config = ConfigService.fromObject({});
    expect(config.get('ANTHROPIC_API_KEY')).toBeUndefined();
    expect(config.get('DATABASE_PATH')).toBeUndefined();
  });

  it('treats `VAR=` in a .env file as unset, not as an empty value', () => {
    const config = ConfigService.fromObject({
      ANTHROPIC_API_KEY: '',
      PORT: '',
      ANTHROPIC_MODEL: '',
      DATABASE_PATH: '',
    });
    expect(config.get('ANTHROPIC_API_KEY')).toBeUndefined();
    expect(config.get('PORT')).toBe(3000);
    expect(config.get('ANTHROPIC_MODEL')).toBe('claude-haiku-5-5');
    expect(config.get('DATABASE_PATH')).toBeUndefined();
  });

  it('coerces numbers and trims strings', () => {
    const config = ConfigService.fromObject({ PORT: '8080', LLM_MAX_RETRIES: '0', ANTHROPIC_API_KEY: '  sk-test  ' });
    expect(config.get('PORT')).toBe(8080);
    expect(config.get('LLM_MAX_RETRIES')).toBe(0);
    expect(config.get('ANTHROPIC_API_KEY')).toBe('sk-test');
  });

  it('reports every invalid value at once, with a stable error code', () => {
    const attempt = () => ConfigService.fromObject({ PORT: 'abc', LLM_TIMEOUT_MS: '-5', LOG_LEVEL: 'loud' });
    expect(attempt).toThrow(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }));
    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/LLM_TIMEOUT_MS/);
    expect(attempt).toThrow(/LOG_LEVEL/);
  });

  describe('getOrThrow', () => {
    it('returns a value that is set', () => {
      expect(ConfigService.fromObject({ ANTHROPIC_API_KEY: 'sk-test' }).getOrThrow('ANTHROPIC_API_KEY')).toBe(
        'sk-test',
      );
    });

    it('throws for a value that is missing, naming it', () => {
      const config = ConfigService.fromObject({});
      expect(() => config.getOrThrow('ANTHROPIC_API_KEY')).toThrow(
        expect.objectContaining({
          code: 'MISSING_CONFIGURATION',
          message: expect.stringContaining('ANTHROPIC_API_KEY'),
        }),
      );
    });
  });

  describe('safe defaults for production', () => {
    it('are relaxed in development: the mock model is allowed and demo orders are seeded', () => {
      const config = ConfigService.fromObject({});
      expect(config.get('NODE_ENV')).toBe('development');
      expect(config.get('REQUIRE_LLM')).toBe(false);
      expect(config.get('SEED_SAMPLE_ORDERS')).toBe(true);
    });

    it('are strict in production: a real model is required and no demo orders are seeded', () => {
      const config = ConfigService.fromObject({ NODE_ENV: 'production' });
      expect(config.get('REQUIRE_LLM')).toBe(true);
      expect(config.get('SEED_SAMPLE_ORDERS')).toBe(false);
    });

    it('can each be overridden explicitly, in either direction', () => {
      const demo = ConfigService.fromObject({ NODE_ENV: 'production', REQUIRE_LLM: 'false', SEED_SAMPLE_ORDERS: '1' });
      expect(demo.get('REQUIRE_LLM')).toBe(false);
      expect(demo.get('SEED_SAMPLE_ORDERS')).toBe(true);
      const strict = ConfigService.fromObject({ REQUIRE_LLM: 'true', SEED_SAMPLE_ORDERS: '0' });
      expect(strict.get('REQUIRE_LLM')).toBe(true);
      expect(strict.get('SEED_SAMPLE_ORDERS')).toBe(false);
    });

    it('read "false" as false, not as a non-empty string', () => {
      expect(ConfigService.fromObject({ REQUIRE_LLM: 'false' }).get('REQUIRE_LLM')).toBe(false);
    });

    it('reject a flag that is not true/false/1/0', () => {
      expect(() => ConfigService.fromObject({ REQUIRE_LLM: 'yes' })).toThrow(/REQUIRE_LLM/);
    });
  });

  describe('review timing', () => {
    it('defaults to three minutes', () => {
      expect(ConfigService.fromObject({}).get('REVIEW_STALE_AFTER_MS')).toBe(180_000);
    });

    it('must outlast the worst-case time to answer a review (one model call), or a live answer could be taken over', () => {
      // 1 call x (2 retries + 1) x 20 s = 60 s of timeouts
      expect(() => ConfigService.fromObject({ REVIEW_STALE_AFTER_MS: '60000' })).toThrow(/REVIEW_STALE_AFTER_MS/);
      expect(() => ConfigService.fromObject({ REVIEW_STALE_AFTER_MS: '60001' })).not.toThrow();
    });
  });

  describe('claim timing', () => {
    it('must outlast the worst-case model time, or a live ticket could be taken over', () => {
      // 2 calls x (2 retries + 1) x 20 s = 120 s of timeouts
      expect(() => ConfigService.fromObject({ CLAIM_STALE_AFTER_MS: '120000' })).toThrow(/CLAIM_STALE_AFTER_MS/);
      expect(() => ConfigService.fromObject({ CLAIM_STALE_AFTER_MS: '120001' })).not.toThrow();
    });
  });
});
