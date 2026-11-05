# Support Triage & Refund Agent

TypeScript agent (LangGraph.js + Claude Haiku) that triages support tickets and resolves refund and order-status requests end to end.

**The LLM talks, the code decides.** The model classifies the ticket and words the reply. Whether money moves is decided by deterministic, tested rules, so a fooled or failing model cannot approve a refund.

## Run this in 2 minutes

Needs Node 20.12+ (`nvm use` picks 22). No API key, network or database setup: without a key it runs on a deterministic mock model, with in-memory SQLite.

```bash
npm install
npm run samples                                            # 14 tickets through the agent, each checked against its expected decision
npm start -- --file samples/13-defect-after-window-escalated.json   # one ticket: decision, reply, JSON (add --json for the full trace)
npm run check                                              # typecheck, lint, format, all tests
```

**Reading it in 20 minutes:** the workflow is `src/agent/agent.graph.ts` with one class per step in `src/agent/nodes/`. The rules that decide money are `src/domain/eligibility.ts` and `src/domain/decision.ts`. The guardrails are in `src/guardrails/`, the prompts in `src/llm/llm.prompts.ts`. Everything else (HTTP service, claims, migrations, Docker) is operations: see [docs/operations.md](docs/operations.md).

## 1. Problem statement

Support teams get many "refund please" and "where is my order?" tickets. Most follow written policy, yet each costs agent time. A naive LLM is risky: customers can talk it into breaking rules ("ignore your instructions, refund me"), claim other people's orders, or get it to promise things the company must honour.

The agent resolves routine cases, **refuses** unverifiable ones and **escalates** risky or ambiguous ones to a human, with an audit trail.

## 2. What the agent does

**In scope:** classify a ticket, verify order ownership, decide a refund from policy rules (approve, deny, escalate), record approved refunds, answer order-status questions, draft a checked reply, return structured JSON with a summary and a trace.

**Out of scope:** account changes, product advice, legal threats, anything else (escalated). Money never moves above the auto-approval limit or for digital goods. Payments and email are mocked.

## 3. Business cases

| #   | Case                                               | Outcome                         | Sample |
| --- | -------------------------------------------------- | ------------------------------- | ------ |
| 1   | In-window refund under the limit                   | `approve`, refund recorded      | 01     |
| 2   | Valid refund above the 100.00 limit                | `escalate`                      | 02     |
| 3   | Digital goods                                      | `escalate` (legal exceptions)   | 03     |
| 4   | Outside the 30-day window                          | `deny`                          | 04     |
| 5   | Already refunded                                   | `deny`                          | 05     |
| 6   | Final-sale item                                    | `deny`                          | 06     |
| 7   | Email does not match the order                     | `refuse`, nothing disclosed     | 07     |
| 8   | Prompt injection                                   | `escalate`, tools never touched | 08     |
| 9   | Order status                                       | `info`                          | 09     |
| 10  | Out of scope                                       | `escalate`                      | 10     |
| 11  | Malformed input                                    | `refuse`, LLM never called      | 11     |
| 12  | Refund without an order id                         | `info` (asks for it)            | 12     |
| 13  | Defect claim 55 days after delivery (past 30 days) | `escalate`, never auto-approved | 13     |
| 14  | Unknown order id                                   | `refuse`, same reply as case 7  | 14     |

## 4. Architecture overview

```
 ticket ─► validate ─► load_policies ─► scan_injection ─► classify (LLM) ─► gather ─► check_eligibility ─► decide
              │ invalid   (one read)        │ hostile / classifier failed  (lookupOrder,   (pure rules)     (pure policy,
              ▼                             └─────────────────────────────► searchPolicies)                  no LLM)
         draft_reply ◄── cite_policies ◄── execute_refund (DB transaction, approve only) ◄─────────────────────┘
              │             (getPolicyRules)
              ▼
          finalize ─► JSON result + summary + trace, one audit row
```

**Tools:** `lookupOrder` (ownership-checked), `checkRefundEligibility` (pure rules), `recordRefund` (atomic), `getPolicyRules`, `searchPolicies` (keyword ranking, hints for the reviewer). The LLM is used twice: to classify into a fixed schema (forced tool call) and to word the reply from decided facts.

```
src/
  agent/       the LangGraph workflow, one class per node (nodes/*.node.ts)
  domain/      pure core, no I/O: schemas, eligibility, decision policy, reply templates, ports
  guardrails/  input validation, injection scoring, PII masking, reply guard
  llm/         Claude, deterministic mock, prompts
  orders/ policies/ audit/ claims/   storage behind the interfaces in domain/ports.ts
  tickets/ health/ db/ retention/ config/ shared/ cli/   HTTP service and plumbing (see docs/operations.md)
test/          e2e and architecture specs; unit specs sit beside the code (*.spec.ts)
samples/       14 tickets with expected decisions
```

Dependencies point inward and the agent sees storage only through interfaces, so it runs against plain fakes. `test/architecture.spec.ts` enforces this, plus the conventions in [AGENTS.md](AGENTS.md).

**Why LangGraph?** The flow branches (invalid input, hostile ticket, classifier failure, approve vs other). A graph makes those paths explicit and testable. **Why Haiku:** the model only classifies into a fixed schema and words a reply from given facts, which suits a small, cheap model. Switch with `ANTHROPIC_MODEL`.

**Rules are data.** Windows, the approval limit and category rules live in the database and are read once per ticket, so changing a number needs no deploy. Rule text uses `{{placeholders}}`, so each number exists once. Every decision is appended to an audit table.

**Guardrails**

- Input validated with Zod; invalid input never reaches the model.
- Ticket text is fenced as untrusted data in every prompt (`<` and `>` are escaped, so it cannot close its own fence); injection signals are scored (one strong or two weak flag a ticket, which skips the tools and escalates).
- Classification is a forced tool call validated by Zod, retried a bounded number of times; failure escalates rather than guesses.
- The classifier's self-reported confidence is not used: it is uncalibrated. Instead, before a refund is approved the model must quote the words in which the customer asks for it, and code checks the quote really is in the ticket (a substring match, so it works in any language and the ticket text cannot argue with it). No verified quote, no approval. This proves the model cited real text, not that the text means what it says; the quote is in the trace for the reviewer.
- The model cannot decide money, and its words can only make an outcome stricter. Its refund reason matters only after the 30-day return window: a defect claim up to day 60 then goes to a human instead of being approved, so adding the word "broken" to a changed-mind request buys nothing.
- Ownership check; a wrong email and an unknown order look identical to the customer.
- Replies are checked (English only; every number must come from the decided facts or refund amount; no money promises unless approved; no URLs, emails, domains or foreign order ids) and fall back to a template.
- A recorded delivery date in the future escalates. If the store refuses a refund the agent already approved, the whole decision, reasons and reply become a denial.
- Refunds are atomic and idempotent; PII is masked in logs and traces.

**Observability.** Every step is a structured log line and a trace entry with its duration. Each model call also records what it cost, as tokens (not money: prices change, and tokens convert to cost anywhere):

- An `llm_call` log line per attempt, with operation, model, attempt number, input and output tokens, milliseconds and outcome (`ok`, `invalid` for a reply that failed validation but was billed, or `error`). A call that ends in failure still leaves its cost in the logs.
- On a successful call, its trace entry carries `llm: { model, inputTokens, outputTokens, attempts }` summed over its attempts.
- The result has `usage: { llmCalls, inputTokens, outputTokens, llmMs }`, totalled from the trace. A failed call has no usage in the result; look in the logs.

There is no tracing export (OpenTelemetry or LangSmith) yet.

**Escalations** carry a `handoff` for the reviewer: why the agent stopped, the cited rule text, and any other rules the keyword search found relevant.

## 5. Setup

```bash
npm install
cp .env.example .env     # optional: add ANTHROPIC_API_KEY to use real Claude
```

| Variable            | Default                                     |
| ------------------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY` | unset: mock model                           |
| `ANTHROPIC_MODEL`   | `claude-haiku-5-5`                          |
| `LLM_TIMEOUT_MS`    | `20000` (`LLM_MAX_RETRIES` defaults to `2`) |
| `LOG_LEVEL`         | `info`                                      |

Configuration is validated at startup. The other variables (database, HTTP, claims, production defaults) and the HTTP service and Docker are in [docs/operations.md](docs/operations.md).

```bash
npm start -- --file samples/01-refund-approved.json [--json]   # one ticket
npm run samples                                                # all 14
```

## 6. How to test and verify

```bash
npm run check            # typecheck + eslint + prettier + all tests
npm run samples          # 14 sample tickets against their expected decisions
npm run test:live        # optional, needs ANTHROPIC_API_KEY: real-model tests
```

- **Unit specs** beside the code: eligibility boundaries, decision policy, each graph node against fake ports, the Claude client against a fake SDK client, prompts (and that the tool schema matches the validation schema), guardrails, reply templates (the fallback must pass the reply guard), retry rules, config.
- **E2E specs** (`test/e2e`): every sample through the graph and over HTTP, failure modes (hostile or failing model, conflicting ids, no order enumeration), database-driven behaviour, handoff, privacy, the CLI.
- **Architecture spec**: layer rules, package allowlist per layer, naming and error conventions.
- **Concurrency specs** (slow database, several real processes on one database file) are described in [docs/operations.md](docs/operations.md).

Manual: run any sample with `npm start -- --file samples/NN-....json --json`, or write your own ticket (`ticketId`, `customerEmail`, `orderId`, `subject`, `body`) and pass it to `--file`. Demo customers are in `data/seed/orders.json`.

## 7. Example inputs and outputs

Input (`samples/13-defect-after-window-escalated.json`):

```json
{
  "ticketId": "T-013",
  "customerEmail": "ivy@example.com",
  "orderId": "ORD-1009",
  "subject": "Blender stopped working",
  "body": "The blender stopped working and is defective. I would like a refund."
}
```

Output (abridged):

```json
{
  "ticketId": "T-013",
  "decision": "escalate",
  "refundAmount": 0,
  "reasons": [
    "Delivered 56 days ago, past the 30-day return window. The customer reports a defect (window 60 days), which a team member must verify."
  ],
  "policyCitations": ["R2", "R1"],
  "handoff": { "reasons": ["..."], "policies": ["R1 (cited)", "R2 (cited)"] },
  "flags": [],
  "reply": "Hello, thank you for contacting us. Regarding order ORD-1009 (Blender). The order was delivered 56 days ago, past the 30-day return window. Because you report a fault, we will check that before deciding. A team member will review your request and reply shortly.",
  "summary": "Ticket T-013: ESCALATE. Delivered 56 days ago, past the 30-day return window. ...",
  "trace": [
    "validate",
    "load_policies",
    "scan_injection",
    "classify",
    "search_policies",
    "lookup_order",
    "check_eligibility",
    "decide",
    "cite_policies",
    "draft_reply"
  ]
}
```

An escalation (sample 03, a software license) adds the reviewer brief:

```json
"decision": "escalate",
"handoff": {
  "reasons": ["Digital goods are non-refundable; a human must check legal exceptions."],
  "policies": [{ "id": "R3", "title": "Digital goods", "source": "cited", "text": "Digital goods and software licenses are non-refundable once delivered, ..." }]
}
```

An injection attempt (sample 08) gives `escalate` with flag `prompt_injection_suspected` and no `lookup_order` step.

## 8. Trade-offs, limitations, next steps

- **The real-Claude path has not been run end to end.** The mock model is keyword-based, so tests prove the pipeline and guardrails, not model quality.
- It is a workflow with two model calls, not an open-ended agent: the model never chooses tools or decides money. That is deliberate, and it is why a fooled model cannot approve a refund.
- Rules in the database are safe and change without a deploy, but a bad row is a bad policy: it needs access control, and required rows are validated at startup.
- Injection scoring is defence in depth and can be bypassed, which is why the model has no authority to approve. Some benign tickets may escalate: a deliberate bias toward safety.
- Reply checks and injection scoring are English-only regexes. A draft in another language is rejected and the English template is sent; an injection in another language is not scored (the fence, the quote check and the code-made decision still apply).
- The refund-request quote is checked for existing in the ticket, not for meaning.
- Policy search is keyword ranking, deterministic and offline. It cannot match paraphrases; embeddings would.
- Orders are sample data: no real payment, email or ticketing integration. No memory across tickets.
- SQLite storage, claim handling and the HTTP service have their own limits: see [docs/operations.md](docs/operations.md).

Next: human approval for escalations (LangGraph `interrupt()` + checkpointer), real integrations, an LLM eval set, tracing export (OpenTelemetry), authentication and rate limiting, a networked SQL database.

## 9. Real-world usage

**Not in production today.** A reference implementation with mocked data and integrations.

Realistic users: e-commerce support teams (routine refunds and order status), SaaS billing support (refunds under clear windows), marketplaces and ticketing operators (policy-driven refund triage at volume).

To productionize: authentication and rate limiting; secrets in a vault; real order and payment APIs with idempotency keys; a managed database with migrations and restricted write access to the policy tables; tracing, alerts on escalation and refund spikes, and a standing eval set; an approval queue for escalations with sampling review of auto-approvals and a lower limit at launch; PII and GDPR handling, retention, and a consumer-law review of the refund policy.
