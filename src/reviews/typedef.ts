export interface ReviewRow {
  review_id: string;
  ticket_id: string;
  thread_id: string;
  status: 'pending' | 'deciding' | 'resolved';
  request_json: string;
  created_at: string | Date;
  resolved_at: string | Date | null;
  decider_token: string | null;
  deciding_since: string | Date | null;
  /** The database's own clock when the row was read. Only present on `findWithClock`. */
  db_now?: string | Date;
  decision: string | null;
  reviewer: string | null;
  note: string | null;
}
