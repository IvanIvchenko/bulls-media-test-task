import type { AuditRepository } from './audit.repository.js';
import type { AuditTrail, Result } from '../domain/index.js';

/** Append-only record of every decision the agent makes. */
export class AuditService implements AuditTrail {
  public constructor(private readonly repository: AuditRepository) {}

  public async record(result: Result, now: Date): Promise<void> {
    await this.repository.insert(result, now);
  }
}
