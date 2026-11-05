# Support Triage Agent

## Project Overview

LangGraph.js agent that triages support tickets and resolves refund and order-status requests. The LLM classifies and words replies; deterministic rules in `domain/` decide. Fastify service and CLI, SQLite through Knex.

## Project Rules

1. Don't over-document obvious things, be laconic, minimal, don't repeat yourself.
2. The model never decides money. Decisions come from `domain/decision.ts` and `domain/eligibility.ts`.
3. Ticket text is untrusted: always `fence` it before it reaches a prompt.

## Conventions

Mostly enforced by `test/architecture.spec.ts`, eslint and prettier.

- Feature folders. Files are `[feature].[type].ts` in kebab-case (`orders.service.ts`, `check-eligibility.node.ts`) plus `typedef.ts` and `constants.ts`. One class per file.
- No barrel `index.ts` except `domain/`.
- Class order: logger (`new Logger(X.name)`), constructor with `private readonly` dependencies, public methods, private methods.
- Services hold logic, repositories hold SQL only, mappers turn rows into domain objects.
- Storage is slow and remote: every port returns a `Promise`, the policy is read once per ticket (`load_policies`), and anything that decides correctness (refunds, reviews) lives in the database, never in process memory. The service is single-instance by design: no locks, no claims, no takeover; a ticket sent twice is run twice and the refund guard keeps the money safe.
- Data access is Knex, never raw SQL strings, and stays dialect-neutral (no `PRAGMA`, no driver types outside `db/`). Schema changes are a new file in `db/migrations/` added to `migrations.ts`; never edit one that has shipped. Keep one SQLite connection per process.
- Layers point inward: `domain` <- features <- `agent` <- entry points. The agent, tickets and health see storage only through `domain/ports.ts`. Concrete classes are wired in `container.ts` only.
- Errors: throw `BusinessLogicError` with an `ErrorCodes` entry, never a raw `Error`, `TypeError` or `RangeError`. The architecture spec lists the one place that may (a layer that cannot import `shared/`), with its reason. `ErrorFilter` turns errors into `{ code, message }`.
- Config: add the key to `config/configuration.ts` and read it through `ConfigService`. No `process.env` in services.
- Constants are `SCREAMING_SNAKE`. Zod schemas are `nameSchema` with the inferred type beside them. Flags and step names come from `FLAG` and `STEP`.
- Nodes read earlier state through `needs(state, ...fields)`, which throws `AGENT_STATE_INVARIANT` if run out of order; never use `!`. A human review is filed under `reviewKeyOf` (ticket id + sender digest).
- Money goes through `roundMoney`.
- Tests that need delays use a seeded generator, never `Math.random`/wall-clock thresholds. The service runs as one instance: do not add code (or tests) that assumes two processes share a file.
- Decisions carry two lists: `reasons` are for the reviewer (third person, internal limits allowed), `facts` are written to the customer and are all the reply model or template sees. Never copy one into the other.
- Human review: the agent pauses with `interrupt()` only when `run` is given a `reviewId` (the HTTP service with `REVIEW_TOKEN`). The reviewer's answer is yes or no; code sets the amount. A paused run is saved by `KnexCheckpointSaver` (db/), only for the review graph, and deleted once answered; never keep a run in memory.
- Rule text (`data/seed/policy.json`, `policy_rules`) is quoted to customers: write it as company policy, never as an instruction to the agent ("escalate", "refuse"). A spec checks it; a changed rule needs a migration that rewrites stored text only if it is still as shipped.
- Prettier: single quotes, trailing commas, width 120. Imports are ordered by eslint (`import-x/order`).
- Unit specs sit beside the code (`*.spec.ts`), e2e specs in `test/e2e/*.e2e-spec.ts`. Tests run offline on the mock model and in-memory SQLite.

## Commands

`npm run check` (typecheck, lint, format, tests), `npm run samples`, `npm run serve`.

## Agent Rules

1. **Evolve** — update this file when a convention changes or a lesson is learned.
