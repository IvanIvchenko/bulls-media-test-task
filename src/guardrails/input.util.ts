import { ticketSchema, type Ticket } from '../domain/index.js';

export type ValidationResult = { ok: true; ticket: Ticket } | { ok: false; errors: string[] };

export function validateTicket(input: unknown): ValidationResult {
  const parsed = ticketSchema.safeParse(input);
  if (parsed.success) return { ok: true, ticket: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}
