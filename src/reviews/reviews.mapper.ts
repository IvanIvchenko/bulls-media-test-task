import type { ReviewRow } from './typedef.js';
import { fromStoredTimestamp } from '../db/timestamps.util.js';
import { resultSchema, type ReviewRecord, type ReviewSummary } from '../domain/index.js';

export class ReviewsMapper {
  public toRecord(row: ReviewRow): ReviewRecord {
    return {
      reviewId: row.review_id,
      ticketId: row.ticket_id,
      threadId: row.thread_id,
      status: row.status,
      request: resultSchema.parse(JSON.parse(row.request_json)),
    };
  }

  public toSummary(row: ReviewRow): ReviewSummary {
    return {
      reviewId: row.review_id,
      ticketId: row.ticket_id,
      summary: resultSchema.parse(JSON.parse(row.request_json)).summary,
      createdAt: fromStoredTimestamp(row.created_at),
    };
  }
}
