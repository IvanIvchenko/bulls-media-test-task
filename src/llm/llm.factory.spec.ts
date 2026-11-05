import { describe, expect, it } from 'vitest';

import { AnthropicLlmService } from './anthropic.service.js';
import { createLlm } from './llm.factory.js';
import { MockLlmService } from './mock.service.js';
import { ConfigService } from '../config/config.service.js';

const config = (env: Record<string, string>) => ConfigService.fromObject(env);

describe('createLlm', () => {
  it('uses Claude when a key is set', () => {
    expect(createLlm(config({ ANTHROPIC_API_KEY: 'sk-test' }))).toBeInstanceOf(AnthropicLlmService);
  });

  it('falls back to the mock model without a key in development', () => {
    expect(createLlm(config({}))).toBeInstanceOf(MockLlmService);
  });

  it('refuses to start without a key when a real model is required, instead of quietly using the mock', () => {
    expect(() => createLlm(config({ REQUIRE_LLM: 'true' }))).toThrow(
      expect.objectContaining({ code: 'MISSING_CONFIGURATION', message: expect.stringContaining('REQUIRE_LLM') }),
    );
  });

  it('requires a key by default in production', () => {
    expect(() => createLlm(config({ NODE_ENV: 'production' }))).toThrow(/ANTHROPIC_API_KEY/);
    expect(createLlm(config({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-test' }))).toBeInstanceOf(
      AnthropicLlmService,
    );
  });

  it('lets production use the mock only when that is asked for explicitly', () => {
    expect(createLlm(config({ NODE_ENV: 'production', REQUIRE_LLM: 'false' }))).toBeInstanceOf(MockLlmService);
  });

  it('treats a blank key as no key', () => {
    expect(() => createLlm(config({ REQUIRE_LLM: 'true', ANTHROPIC_API_KEY: '   ' }))).toThrow(/ANTHROPIC_API_KEY/);
  });
});
