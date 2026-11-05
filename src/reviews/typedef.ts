export interface ReviewRow {
  review_id: string;
  ticket_id: string;
  order_id: string;
  thread_id: string;
  status: 'pending' | 'deciding' | 'resolved';
  request_json: string;
  final_json: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
  decision: string | null;
  reviewer: string | null;
  note: string | null;
}
