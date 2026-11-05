import type { FastifyInstance } from 'fastify';

import { IDEMPOTENT_REPLAY_HEADER } from './constants.js';
import type { TicketsService } from './tickets.service.js';
import { FLAG, type Result } from '../domain/index.js';
import { HttpStatus } from '../shared/http-status.js';
import type { Controller } from '../shared/typedef.js';

export class TicketsController implements Controller {
  public constructor(private readonly service: TicketsService) {}

  public register(app: FastifyInstance): void {
    app.post('/tickets', async (request, reply) => {
      const outcome = await this.service.process(request.body);
      if (outcome.kind === 'replayed') reply.header(IDEMPOTENT_REPLAY_HEADER, 'true');
      return reply.status(this.statusFor(outcome.result)).send(outcome.result);
    });
  }

  /** Invalid input is the caller's mistake (400). Every other decision, including a refusal, is a successful run. */
  private statusFor(result: Result): number {
    return result.flags.includes(FLAG.INVALID_INPUT) ? HttpStatus.BAD_REQUEST : HttpStatus.OK;
  }
}
