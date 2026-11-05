import { AgentService } from './agent/agent.service.js';
import { ApprovalsService } from './approvals/approvals.service.js';
import { AuditRepository } from './audit/audit.repository.js';
import { AuditService } from './audit/audit.service.js';
import type { ConfigService } from './config/config.service.js';
import { KnexCheckpointSaver } from './db/knex-checkpoint.saver.js';
import type { Database } from './db/typedef.js';
import { RULE, type AuditTrail, type OrderTools, type PolicyTools, type ReviewStore } from './domain/index.js';
import { HealthService } from './health/health.service.js';
import { createLlm } from './llm/llm.factory.js';
import type { LLM } from './llm/typedef.js';
import { OrdersMapper } from './orders/orders.mapper.js';
import { OrdersRepository } from './orders/orders.repository.js';
import { OrdersService } from './orders/orders.service.js';
import { PoliciesMapper } from './policies/policies.mapper.js';
import { PoliciesRepository } from './policies/policies.repository.js';
import { PoliciesService } from './policies/policies.service.js';
import { ReviewsMapper } from './reviews/reviews.mapper.js';
import { ReviewsRepository } from './reviews/reviews.repository.js';
import { ReviewsService } from './reviews/reviews.service.js';
import { TicketsService } from './tickets/tickets.service.js';

/** The storage the rest of the app sees: interfaces only, every call async. */
export interface Ports {
  orders: OrderTools;
  policies: PolicyTools;
  audit: AuditTrail;
  reviews: ReviewStore;
}

export interface ContainerOptions {
  config: ConfigService;
  database: Database;
  /** Defaults to Claude when a key is configured, otherwise the deterministic mock. */
  llm?: LLM;
  now?: () => Date;
  /** Replace any port, e.g. with a fake or one that adds latency in tests. */
  ports?: Partial<Ports>;
}

/** Every service, wired. The one place that knows which concrete class implements which interface. */
export interface Container extends Ports {
  config: ConfigService;
  database: Database;
  llm: LLM;
  agent: AgentService;
  tickets: TicketsService;
  /** Present only when REVIEW_TOKEN is set: human review of escalations is off without it. */
  approvals?: ApprovalsService;
  health: HealthService;
  /** Startup check: the database must contain every rule and setting the code depends on. */
  verify(): Promise<void>;
  close(): Promise<void>;
}

/** The database-backed implementation of every port. `policies` is the concrete service, which can also verify itself. */
export function createPorts(database: Database): Ports & { policies: PoliciesService } {
  return {
    orders: new OrdersService(new OrdersRepository(database), new OrdersMapper()),
    policies: new PoliciesService(new PoliciesRepository(database), new PoliciesMapper()),
    audit: new AuditService(new AuditRepository(database)),
    reviews: new ReviewsService(new ReviewsRepository(database), new ReviewsMapper()),
  };
}

export function createContainer(options: ContainerOptions): Container {
  const { config, database } = options;
  const llm = options.llm ?? createLlm(config);
  const now = options.now ?? (() => new Date());
  const defaults = createPorts(database);
  const ports: Ports = { ...defaults, ...options.ports };

  const agent = new AgentService({ llm, ...ports, checkpointer: new KnexCheckpointSaver(database), now });
  const tickets = new TicketsService(agent, { reviewsEnabled: Boolean(config.get('REVIEW_TOKEN')) });
  const health = new HealthService(async () => void (await database.raw('select 1')), llm.name);

  return {
    config,
    database,
    llm,
    ...ports,
    agent,
    tickets,
    approvals: config.get('REVIEW_TOKEN') ? new ApprovalsService(ports.reviews, agent) : undefined,
    health,
    // Always checks the real database, even when a test swaps a port for a fake.
    verify: () => defaults.policies.assertRulesExist(Object.values(RULE)),
    close: () => database.destroy(),
  };
}
