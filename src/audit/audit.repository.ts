import { TABLE } from '../db/constants.js';
import type { Database } from '../db/typedef.js';
import type { Result } from '../domain/index.js';

export class AuditRepository {
  public constructor(private readonly database: Database) {}

  public async insert(result: Result, createdAt: Date): Promise<void> {
    await this.database(TABLE.DECISIONS).insert({
      ticket_id: result.ticketId,
      decision: result.decision,
      refund_amount: result.refundAmount,
      flags: result.flags.join(','),
      summary: result.summary,
      result_json: JSON.stringify(result),
      created_at: createdAt.toISOString(),
    });
  }
}
