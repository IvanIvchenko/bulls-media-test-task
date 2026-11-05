export interface ClaimRow {
  ticket_id: string;
  request_hash: string;
  status: 'in_progress' | 'done';
  owner_token: string;
  result_json: string | null;
  claimed_at: string | Date;
  /** The database's own clock when the row was read. */
  db_now: string | Date;
}
