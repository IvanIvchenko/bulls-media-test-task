import { createHash, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ApprovalsService } from './approvals.service.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';
import type { Controller } from '../shared/typedef.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Reviewer routes. Everything here needs the shared review token: this is a person with authority over refunds. */
export class ApprovalsController implements Controller {
  public constructor(
    private readonly service: ApprovalsService,
    private readonly token: string,
  ) {}

  public register(app: FastifyInstance): void {
    app.get('/reviews', async (request) => {
      this.authorise(request);
      return { reviews: await this.service.pending() };
    });

    app.get<{ Params: { id: string } }>('/reviews/:id', async (request) => {
      this.authorise(request);
      const { reviewId, ticketId, status, request: escalation } = await this.service.get(request.params.id);
      return { reviewId, ticketId, status, escalation };
    });

    app.post<{ Params: { id: string } }>('/reviews/:id/decision', async (request) => {
      this.authorise(request);
      return this.service.decide(request.params.id, request.body);
    });
  }

  /** Constant-time comparison, so the token cannot be guessed from response times. */
  private authorise(request: FastifyRequest): void {
    const header = request.headers.authorization ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!timingSafeEqual(digest(supplied), digest(this.token))) {
      throw new BusinessLogicError('A valid review token is required.', ErrorCodes.REVIEW_UNAUTHORIZED);
    }
  }
}
