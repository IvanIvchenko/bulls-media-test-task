import type { FastifyInstance } from 'fastify';

import type { HealthService } from './health.service.js';
import type { Controller } from '../shared/typedef.js';

export class HealthController implements Controller {
  public constructor(private readonly service: HealthService) {}

  public register(app: FastifyInstance): void {
    app.get('/health', async () => this.service.check());
  }
}
