import type { FastifyReply, FastifyRequest } from 'fastify';

import { BusinessLogicError } from '../errors/business-logic-error.js';
import { ErrorCodes } from '../errors/error-codes.js';
import { HttpStatus } from '../http-status.js';
import { Logger } from '../logger/logger.js';

interface FrameworkError extends Error {
  statusCode?: number;
  code?: string;
}

/** The one place errors become HTTP responses: always `{ code, message }`, never a stack trace. */
export class ErrorFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  public handle(thrown: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    if (thrown instanceof BusinessLogicError) {
      if (thrown.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error('Business error', { err: thrown.message, code: thrown.code, extra: thrown.extra });
      }
      return reply.status(thrown.status).send({ code: thrown.code, message: thrown.message });
    }

    const error: FrameworkError = thrown instanceof Error ? thrown : new Error(String(thrown));
    const status = error.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
      // Client mistakes (malformed JSON, body too large, wrong content type) are safe to describe.
      return reply.status(status).send({ code: error.code ?? 'BAD_REQUEST', message: error.message });
    }

    request.log.error({ err: error }, 'Unhandled exception'); // full detail stays in the logs
    return reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
  }

  public notFound(reply: FastifyReply): FastifyReply {
    return reply
      .status(ErrorCodes.NOT_FOUND.status)
      .send({ code: ErrorCodes.NOT_FOUND.code, message: 'Route not found' });
  }
}
