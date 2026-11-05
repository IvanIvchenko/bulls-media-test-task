import type { FastifyInstance } from 'fastify';

import type { TicketsService } from './tickets.service.js';
import { FLAG, type Result } from '../domain/index.js';
import { HttpStatus } from '../shared/http-status.js';
import type { Controller } from '../shared/typedef.js';

export class TicketsController implements Controller {
  public constructor(private readonly service: TicketsService) {}

  public register(app: FastifyInstance): void {
    app.post('/tickets', async (request, reply) => {
      const result = await this.service.process(request.body);
      return reply.status(this.statusFor(result)).send(result);
    });
  }

  /**
   * Invalid input is the caller's mistake (400). A decision a person still has to confirm is accepted but not final
   * (202). Every other decision, including a refusal, is a successful run.
   */
  private statusFor(result: Result): number {
    if (result.flags.includes(FLAG.INVALID_INPUT)) return HttpStatus.BAD_REQUEST;
    return result.review?.status === 'pending' ? HttpStatus.ACCEPTED : HttpStatus.OK;
  }
}
