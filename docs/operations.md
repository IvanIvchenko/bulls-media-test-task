# Operations

Running the agent as a service, and what keeps it correct when several instances share one database. None of this is needed to try the agent: see the [README](../README.md) for that.

## HTTP service

`npm run serve` (listens on `127.0.0.1:3000`).

| Route           | Notes                                                |
| --------------- | ---------------------------------------------------- |
| `POST /tickets` | JSON body. Returns the result; 400 for invalid input |
| `GET /health`   | Database check; 503 if unreachable                   |

```bash
curl -s -X POST localhost:3000/tickets -H 'content-type: application/json' \
  -d '{"ticketId":"T-100","customerEmail":"anna@example.com","orderId":"ORD-1001","subject":"Refund","body":"Changed my mind about the headphones."}'
```

Errors are always `{ code, message }`. Every response carries an `X-Request-Id` (a client-sent one is reused) that appears on every log line of that request. Responses are `Cache-Control: no-store`.

**There is no authentication.** It binds to localhost by default; put a gateway in front before exposing it. The result JSON is for trusted systems (its trace says whether an order exists); forward only `reply` to customers.

## Idempotency

**The key is the ticket id plus the sender's email**, so another customer cannot block or read someone else's ticket id. The database is the referee (`ticket_claims`, primary key), so it holds across instances:

- First request for an id claims it, runs the agent and stores the decision.
- An identical resend returns the stored decision with `Idempotent-Replay: true` and touches nothing, so a client retry cannot turn an approved refund into "denied: already refunded".
- Identical requests at the same moment, even on different instances, run the agent once; the others wait for it, then replay. If the owner takes longer than `CLAIM_WAIT_MS` they get `409 TICKET_IN_PROGRESS` and can retry.
- The same id with a different payload gets `409 TICKET_ID_CONFLICT`.
- A request rejected as invalid, or a run that fails, gives the id back so the client can fix and resend.
- If an instance dies mid-run, its claim goes stale after `CLAIM_STALE_AFTER_MS` and exactly one other caller takes it over. A late-returning owner is fenced out by its token.
- If an instance dies after recording a refund but before storing the decision, the retry sees that its own ticket made the refund and decides again as the first run did. It does not pay twice. If the return window closed in between, the answer is decided on today's date.

Claim times are stamped by the database and a claim's age is measured by the database, so clock skew between hosts cannot make a live claim look stale. The wait for a duplicate uses a monotonic clock. `CLAIM_STALE_AFTER_MS` is a fixed timeout and must stay above the model's worst case; startup checks this.

## Storage

Storage is treated as slow, remote and shared by several processes. Every port method returns a `Promise`. The policy is read once per ticket (`load_policies`) and used from memory afterwards, so a ticket costs a handful of round trips (orders, one policy read, the claim, the audit row). Nothing that decides correctness lives in process memory: it lives in the database.

Data access goes through Knex, not the SQLite driver. Repositories use the query builder and the schema is a versioned migration written with the schema builder, so nothing above `db/` knows which SQL database is underneath. A different database would change how the handle is created (`db/database.client.ts`) and the startup lock (`db/init-lock.util.ts`), nothing else. Migrations run at startup under a lock (SQLite's write lock), so several processes booting together migrate and seed exactly once.

- Refunds are atomic and idempotent: a guarded `UPDATE` plus `UNIQUE (order_id)`.
- Policy rules, windows and the approval limit are rows (`policy_settings`, `category_rules`, `policy_rules`): `UPDATE policy_settings SET value = 500 WHERE key = 'auto_approve_limit'` changes behaviour with no deploy. A bad row is a bad policy, so restrict write access to these tables. Required rows are validated at startup.
- Every decision is appended to `decisions` (audit).
- `npm run db:seed` creates `data/store.db` to inspect or keep state between runs.
- `npm run db:prune -- --days 90` deletes decisions and finished claims older than 90 days. It never touches refunds or claims still in progress, and `--days` has no default.

## Configuration

Validated at startup and read only through `ConfigService`.

| Variable                                                 | Default                                  |
| -------------------------------------------------------- | ---------------------------------------- |
| `ANTHROPIC_API_KEY`                                      | unset: mock model                        |
| `ANTHROPIC_MODEL`                                        | `claude-haiku-5-5`                       |
| `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`                      | `20000`, `2`                             |
| `LLM_RETRY_BASE_MS`                                      | `200` (doubles per retry, with jitter)   |
| `DATABASE_PATH`                                          | CLI: in-memory. Service: `data/store.db` |
| `HOST`, `PORT`, `BODY_LIMIT_BYTES`                       | `127.0.0.1`, `3000`, `16384`             |
| `CLAIM_STALE_AFTER_MS`, `CLAIM_WAIT_MS`, `CLAIM_POLL_MS` | `180000`, `30000`, `200`                 |
| `NODE_ENV`                                               | `development`                            |
| `REQUIRE_LLM`                                            | `true` in production, else `false`       |
| `SEED_SAMPLE_ORDERS`                                     | `false` in production, else `true`       |
| `LOG_LEVEL`                                              | `info`                                   |

`CLAIM_STALE_AFTER_MS` must exceed the worst-case model time (2 calls x (retries + 1) x timeout); startup fails otherwise. With `NODE_ENV=production` the service refuses to start without a key and does not seed demo orders.

## Docker

Multi-stage, non-root, SQLite on the `/data` volume, health check.

```bash
docker build -t support-triage-agent .
docker run --rm -p 127.0.0.1:3000:3000 -v triage-data:/data \
  -e NODE_ENV=production -e ANTHROPIC_API_KEY=sk-... support-triage-agent
# offline demo instead: -e REQUIRE_LLM=false -e SEED_SAMPLE_ORDERS=true
```

Publish the port on `127.0.0.1`: the service has no authentication. CI (`.github/workflows/ci.yml`) runs the checks and samples, the build and the Docker build. The workflow has never run on GitHub.

## Tests for this material

- **Slow-database specs** wrap every storage port to answer after 1-15 ms (seeded, so a failure reproduces), then re-run the concurrency cases. A counting wrapper pins the number of database round trips per ticket: one policy read, no order or policy reads for invalid input, a replay costs one claim lookup.
- **Multi-instance specs** start real separate OS processes at the same moment on a brand-new database. Seeding is race-safe, an identical ticket is processed exactly once, tickets racing for one order refund it once, and a dead instance's claim is taken over by exactly one surviving process.

## Limits

- SQLite is the zero-setup default. Several processes on **one host** can share the file (WAL, a busy timeout, retried initialisation, atomic claims), but it does not work over a network filesystem and allows one writer at a time. Several hosts need a networked SQL database. With Knex, async ports and the dialect-neutral schema that is a connection change plus a different startup lock, not a rewrite. It has not been tried in this repository.
- SQLite's driver is synchronous: a lock wait blocks that process's event loop, and **two connections to one SQLite file inside one process can deadlock** until the busy timeout. Knex's pool is capped at one connection for that reason, which is also why the multi-instance specs use separate processes.
- Amounts are rounded to whole cents at the boundaries (the column is a two-place decimal, but SQLite returns floats).
- Shutdown (`SIGINT`, `SIGTERM`) lets in-flight requests finish and closes the database, with no deadline: a hung request waits until the orchestrator kills the process.
