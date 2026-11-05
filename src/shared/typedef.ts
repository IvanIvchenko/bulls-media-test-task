import type { FastifyInstance } from 'fastify';

/** An HTTP controller: registers its routes on the server. */
export interface Controller {
  register(app: FastifyInstance): void;
}
