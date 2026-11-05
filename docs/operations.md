# Operations

Running the agent as a service. **It is built to run as a single instance** on one SQLite file: see Limits. None of this is needed to try the agent: see the [README](../README.md) for that.

## HTTP service

`npm run serve` (listens on `127.0.0.1:3000`).

| Route           | Notes                                                |
| --------------- | ---------------------------------------------------- |
| `POST /tickets` | JSON body. Returns the result; 400 for invalid input |
| `GET /health`   | Database check; 503 if unreachable                   |

With `REVIEW_TOKEN` set there are also `GET /reviews`, `GET /reviews/:id` and `POST /reviews/:id/decision` (see below).

```bash
curl -s -X POST localhost:3000/tickets -H 'content-type: application/json' \
  -d '{"ticketId":"T-100","customerEmail":"anna@example.com","orderId":"ORD-1001","subject":"Refund","body":"Changed my mind about the headphones."}'
```

Errors are always `{ code, message }`. Every response carries an `X-Request-Id` (a client-sent one is reused) that appears on every log line of that request. Responses are `Cache-Control: no-store`.

State lives in one SQLite file (`data/store.db`); `npm run db:seed` creates it ahead of time. Policy rules, windows and the approval limit are rows in it, so changing one needs no deploy.

**There is no authentication.** It binds to localhost by default; put a gateway in front before exposing it. The result JSON is for trusted systems (its trace says whether an order exists); forward only `reply` to customers.

## Human review of escalations

Off by default. Set `REVIEW_TOKEN` (16+ characters) and the agent pauses on the escalations a person can settle: a refund request on a verified order (over the limit, digital goods, a defect claim after the return window, an unconfirmed request). Hostile, unverified, out-of-scope and already-refunded tickets are not paused: they go to a human outside the agent, as before.

How it runs:

- The customer is answered at once with the usual escalation reply. `POST /tickets` returns **202** with `review: { status: "pending" }`, and the review is queued. A ticket sent again while it waits is run again and replaces its own earlier review, so there is still one.
- `GET /reviews` lists waiting reviews (oldest first). `GET /reviews/:id` shows one escalation. `POST /reviews/:id/decision` with `{ "action": "approve" | "deny", "reviewer": "Maria", "note": "..." }` answers it. The id is the review key (`T-001:<sender digest>`: the ticket id and a digest of the sender, so two customers can use the same ticket id), URL-encoded.
- All three need `Authorization: Bearer <REVIEW_TOKEN>`. There are no accounts: whoever holds the token is the reviewer, and `reviewer` is the name they give. Put a gateway in front for anything real.
- The saved state of a paused run (`graph_checkpoints`, `graph_writes`) holds the ticket text and the sender's email until the review is answered, then it is deleted. Treat those tables like the rest of the customer data.
- The order is read again at the moment of payment. If it changed since the reviewer saw it (a corrected amount, a new category, no longer delivered, gone, or refunded by another ticket) nothing is refunded: a refunded order is denied as such, any other change goes back to a person (`decision: escalate`, the reason in `reasons`).
- The reviewer decides **whether**, never how much: an approval refunds the order's own amount through the same guarded `recordRefund`, so a double click or a second reviewer cannot pay twice. The reply is redrafted and a second audit row is written. The reviewer's name and note go to the audit trail and the result's `summary`, never into the customer's reply.
- Once approved, a resend of the ticket is answered with that refund, for the amount actually paid, and nothing is paid twice. A reviewer's **no sticks**: the same ticket (same id, same sender) sent again, however it is reworded, gets the stored denial back exactly as given, with no model call, no new audit row and no new review, so a customer cannot resend until a more lenient reviewer picks it up. A new ticket, even about the same order, is a new case and gets its own review, but its handoff lists the earlier denials of that order (which ticket, who, when, and the note), and the list shows how many (`priorDenials`), so whoever answers decides knowing.
- Exactly one answer wins, even if two reviewers answer at the same moment: a second gets `409 REVIEW_NOT_PENDING`. If the run cannot be continued, or recording the answer fails, the review goes back to waiting and its saved run is kept. If the service itself dies while an answer is being applied, the review is left "deciding"; the next start puts every such review back to waiting, which is safe because one instance owns the database.
- A retry carries on from the last saved step, so an answer that was already applied (money may have moved on it) stands even if the retry is someone else's. The review is recorded with the answer that was applied, and any other reviewer gets `409 REVIEW_ALREADY_ANSWERED` naming it, even if their answer says the same thing, so nobody believes they decided when they did not. A reviewer retrying their own answer after a failure is not told that: it is theirs. `review` in the result is what the reviewer answered; `decision` is the outcome (an approval the store then refused is a denial).

How a run pauses (LangGraph): the workflow graph runs the ticket as always. If it ends in an escalation a reviewer can settle, the run continues in a second, small graph: `human_review` calls `interrupt()` and the run stops there. Resuming sends a `Command({ resume })`, an `apply_review` node turns the answer into a decision, and the reply is redrafted and recorded. Only that second graph has a checkpointer, so only paused runs are saved and a ticket that never needs a reviewer writes nothing extra.

The checkpointer is `KnexCheckpointSaver` (`src/db/knex-checkpoint.saver.ts`), an implementation of LangGraph's `BaseCheckpointSaver` on the application's own Knex handle. Paused state therefore lives in the same database as everything else that decides correctness, so it survives a restart. The ready-made `@langchain/langgraph-checkpoint-sqlite` and `-postgres` savers were not used because each opens its own driver connection, which would break two rules here: one SQLite connection per process (a second can deadlock the synchronous driver) and no driver types outside `db/`. Its spec runs the same pause-and-resume graph on this saver and on the library's in-memory saver and requires identical results. Resuming is safe to repeat: if applying an answer failed part way, a retry carries on from the last saved step.

Limits: a review never expires and nobody is notified (poll `GET /reviews`), and answered reviews are never deleted. There is no per-reviewer identity, rate limiting or audit of who held the token.

## Configuration

Validated at startup and read only through `ConfigService`.

| Variable                            | Default                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                 | unset: mock model                                          |
| `ANTHROPIC_MODEL`                   | `claude-haiku-5-5`                                         |
| `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` | `20000`, `2`                                               |
| `LLM_RETRY_BASE_MS`                 | `200` (doubles per retry, with jitter)                     |
| `DATABASE_PATH`                     | CLI: in-memory. Service: `data/store.db`                   |
| `HOST`, `PORT`, `BODY_LIMIT_BYTES`  | `127.0.0.1`, `3000`, `16384`                               |
| `NODE_ENV`                          | `development`                                              |
| `REQUIRE_LLM`                       | `true` in production, else `false`                         |
| `SEED_SAMPLE_ORDERS`                | `false` in production, else `true`                         |
| `REVIEW_TOKEN`                      | unset: no human review                                     |
| `LOG_LEVEL`                         | `info` (`debug` also logs reply drafts the guard rejected) |

With `NODE_ENV=production` the service refuses to start without a key and does not seed demo orders.

## Docker

Multi-stage, non-root, SQLite on the `/data` volume, health check.

```bash
docker build -t support-triage-agent .
docker run --rm -p 127.0.0.1:3000:3000 -v triage-data:/data \
  -e NODE_ENV=production -e ANTHROPIC_API_KEY=sk-... support-triage-agent
# offline demo instead: -e REQUIRE_LLM=false -e SEED_SAMPLE_ORDERS=true
```

Publish the port on `127.0.0.1`: the service has no authentication. CI (`.github/workflows/ci.yml`) runs the checks and samples, the build and the Docker build. The workflow has never run on GitHub.

## Limits

- **Single instance.** One process per SQLite file: no startup locks, no ticket claims, no takeover of a review someone is answering. A ticket sent twice is simply run twice (another model call and audit row); the refund guard in the database (one refund per order, and a ticket that already got its refund is answered with it again) keeps the money safe. See the README.
- SQLite's driver is synchronous, so a lock wait blocks the event loop and **two connections to one file inside one process can deadlock**. The pool is capped at one connection. The busy timeout and WAL mode are set so the CLI can read the file while the service runs.
- Nothing is pruned, and shutdown (`SIGINT`, `SIGTERM`) has no deadline: a hung request waits until the orchestrator kills the process.
