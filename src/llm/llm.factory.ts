import { AnthropicLlmService } from './anthropic.service.js';
import { MockLlmService } from './mock.service.js';
import type { LLM } from './typedef.js';
import type { ConfigService } from '../config/config.service.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';
import { Logger } from '../shared/logger/logger.js';

const logger = new Logger('LlmFactory');

/**
 * Claude when a key is configured. Without one: the deterministic mock (offline, no cost), or, when REQUIRE_LLM is
 * on (the default in production), a startup failure, so a missing key can never quietly downgrade a live service.
 */
export function createLlm(configService: ConfigService): LLM {
  if (!configService.get('ANTHROPIC_API_KEY')) {
    if (configService.get('REQUIRE_LLM')) {
      throw new BusinessLogicError(
        'ANTHROPIC_API_KEY is not set and REQUIRE_LLM is on, so the service will not start on the mock model. ' +
          'Set the key, or set REQUIRE_LLM=false to use the mock deliberately.',
        ErrorCodes.MISSING_CONFIGURATION,
      );
    }
    logger.warn('ANTHROPIC_API_KEY not set: using deterministic mock LLM');
    return new MockLlmService();
  }
  return new AnthropicLlmService(configService);
}
