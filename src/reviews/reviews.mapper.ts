import type { ReviewRow } from './typedef.js';
import { fromStoredTimestamp } from '../db/timestamps.util.js';
import { resultSchema, type ReviewAnswer, type ReviewRecord, type ReviewSummary } from '../domain/index.js';

export class ReviewsMapper {
  public toRecord(row: ReviewRow): ReviewRecord {
    return {
      reviewId: row.review_id,
      ticketId: row.ticket_id,
      orderId: row.order_id,
      threadId: row.thread_id,
      status: row.status,
      request: resultSchema.parse(JSON.parse(row.request_json)),
      ...(row.status === 'resolved' && row.decision
        ? {
            answer: {
              action: row.decision as ReviewAnswer['action'],
              reviewer: row.reviewer ?? 'unknown',
              note: row.note ?? undefined,
            },
            finalResult: row.final_json ? resultSchema.parse(JSON.parse(row.final_json)) : undefined,
          }
        : {}),
    };
  }

  public toSummary(row: ReviewRow): ReviewSummary {
    const request = resultSchema.parse(JSON.parse(row.request_json));
    return {
      reviewId: row.review_id,
      ticketId: row.ticket_id,
      summary: request.summary,
      createdAt: fromStoredTimestamp(row.created_at),
      priorDenials: request.handoff?.priorDenials?.length ?? 0,
    };
  }
}
