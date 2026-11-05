import type { ClaimRow } from './typedef.js';
import { fromStoredTimestamp } from '../db/timestamps.util.js';
import { resultSchema, type ClaimRecord } from '../domain/index.js';

export class ClaimsMapper {
  public toRecord(row: ClaimRow): ClaimRecord {
    return {
      ticketId: row.ticket_id,
      requestHash: row.request_hash,
      status: row.status,
      ownerToken: row.owner_token,
      result: row.result_json ? resultSchema.parse(JSON.parse(row.result_json)) : undefined,
      ageMs: Math.max(0, fromStoredTimestamp(row.db_now).getTime() - fromStoredTimestamp(row.claimed_at).getTime()),
    };
  }
}
