import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyBaseLogger } from 'fastify';

import { ApprovalsController } from './approvals/approvals.controller.js';
import type { Container } from './container.js';
import { HealthController } from './health/health.controller.js';
import { ErrorFilter } from './shared/filters/error.filter.js';
import { Logger } from './shared/logger/logger.js';
import { requestContext } from './shared/logger/request-context.js';
import { TicketsController } from './tickets/tickets.controller.js';

const REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_ID_HEADER = 'x-request-id';
/** A caller's own request id is accepted only if it is short and plain, so it cannot forge or flood the logs. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Fastify wiring: controllers, the global error filter, and response headers. All logic lives in the services. */
export function buildServer(container: Container) {
  const errorFilter = new ErrorFilter();
  const app = Fastify({
    loggerInstance: Logger.pino as FastifyBaseLogger,
    bodyLimit: container.config.get('BODY_LIMIT_BYTES'),
    requestTimeout: REQUEST_TIMEOUT_MS,
    genReqId: (request) => {
      const supplied = request.headers[REQUEST_ID_HEADER];
      return typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    },
  });

  app.removeContentTypeParser('text/plain'); // JSON only: anything else gets 415

  // Everything this request logs, from any layer, carries its id; the caller gets it back to quote in a report.
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('X-Request-Id', request.id);
    requestContext.run({ requestId: request.id }, done);
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store'); // responses can contain customer data
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.setNotFoundHandler((_request, reply) => errorFilter.notFound(reply));
  app.setErrorHandler((error, request, reply) => errorFilter.handle(error, request, reply));

  new HealthController(container.health).register(app);
  new TicketsController(container.tickets).register(app);
  const reviewToken = container.config.get('REVIEW_TOKEN');
  if (container.approvals && reviewToken) new ApprovalsController(container.approvals, reviewToken).register(app);

  return app;
}
