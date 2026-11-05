import { z } from 'zod';

const decisionKindSchema = z.enum(['approve', 'deny', 'escalate', 'refuse', 'info']);

/** What one model call cost: tokens summed over every attempt that reached the API, and how many attempts it took. */
export const llmUsageSchema = z.object({
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  attempts: z.number().int().positive(),
});
export type LlmUsage = z.infer<typeof llmUsageSchema>;

const traceEntrySchema = z.object({
  step: z.string(),
  tool: z.string().optional(),
  ok: z.boolean(),
  detail: z.string(),
  ms: z.number().optional(),
  /** Present on a model call that succeeded. */
  llm: llmUsageSchema.optional(),
});
export type TraceEntry = z.infer<typeof traceEntrySchema>;

const handoffSchema = z.object({
  /** Why the agent could not decide on its own. */
  reasons: z.array(z.string()),
  /** "cited": the rule the decision rested on. "suggested": found by policy search as possibly relevant. */
  policies: z.array(
    z.object({ id: z.string(), title: z.string(), text: z.string(), source: z.enum(['cited', 'suggested']) }),
  ),
  /** Earlier reviews of other tickets about this same order that ended in a no, so the reviewer decides knowing. */
  priorDenials: z
    .array(
      z.object({
        ticketId: z.string(),
        reviewer: z.string(),
        note: z.string().optional(),
        /** ISO time the answer was given. */
        decidedAt: z.string(),
      }),
    )
    .optional(),
});
export type Handoff = z.infer<typeof handoffSchema>;

/** Where a human review of an escalation stands. Absent when no review was involved. */
const reviewStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'denied']),
  reviewer: z.string().optional(),
  note: z.string().optional(),
});
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** The structured, machine-readable result of one agent run. */
export const resultSchema = z.object({
  ticketId: z.string(),
  decision: decisionKindSchema,
  refundAmount: z.number().nonnegative(),
  intent: z.string().nullable(),
  reasons: z.array(z.string()),
  policyCitations: z.array(z.string()),
  /** Present only when the decision is `escalate`: everything a human reviewer needs to pick the case up. */
  handoff: handoffSchema.nullable(),
  flags: z.array(z.string()),
  reply: z.string(),
  summary: z.string(),
  trace: z.array(traceEntrySchema),
  review: reviewStatusSchema.optional(),
  /** Totals over the model calls in the trace. Results stored before this existed read as zero. */
  usage: z
    .object({
      llmCalls: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      llmMs: z.number().nonnegative(),
    })
    .default({ llmCalls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0 }),
});
export type Result = z.infer<typeof resultSchema>;
