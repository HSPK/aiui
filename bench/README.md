# Benchmarks

`vitest bench` micro-benchmarks for Loom's hot paths — the code that runs
per-request or, worse, per-token.

```bash
bun run bench                     # everything
npx vitest bench --run bench/gateway-stream.bench.ts
./scripts/vitest-docker.sh bench --run    # no local node
```

## What is measured and why

| File | Hot path | Why it matters |
| --- | --- | --- |
| `crypto.bench.ts` | `decryptSecret` | Runs once per gateway request to unseal the provider API key |
| `gateway-params.bench.ts` | `mergeParams` + `applyFieldFilter` | Runs once per gateway request, on every body |
| `gateway-stream.bench.ts` | `parseStreamChunk` + SSE transcode | Runs **per token** on every streamed response |
| `sse-parser.bench.ts` | `SSEParser.parse` | Runs per network chunk in the browser during playground streaming |
| `db-queries.bench.ts` | `listLogs`, `getOverview`, `listMessages` | Page loads against a realistically-sized table |

Benchmarks are checked in so regressions are visible in a diff, not
discovered in production. They are excluded from coverage.

## Findings

### `generation_logs` had no index for the unfiltered admin view

The table carried three composite indexes, but all of them lead with a
filter column (`user_id`, `capability`, `status`). The *default* logs view
(admin, no filter) and every stats aggregate filter on `is_deleted` and
range-scan `created_at`, so none of them applied:

```
SELECT id FROM generation_logs WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 20
-- before: SCAN generation_logs USING INDEX gen_logs_created_idx
-- after:  SEARCH generation_logs USING INDEX gen_logs_deleted_created_idx (is_deleted=?)
```

Fixed by `gen_logs_deleted_created_idx (is_deleted, created_at)` —
migration `0024`. It also turns the list-total `COUNT(*)` into a covering
index read.

### SQLite was choosing indexes blind

With nine indexes on `generation_logs` and no `sqlite_stat1`, the planner
guessed, and guessed badly — it pinned the logs-list `COUNT(*)` and the
stats aggregates to an index that forced a table lookup per row. On 60k
rows:

| Query | No statistics | After `ANALYZE` |
| --- | --- | --- |
| logs list `COUNT(*)` + `model_name LIKE` | 21.8 ms | 6.6 ms |
| stats totals | 20.7 ms | 6.5 ms |
| stats `GROUP BY model_name` | 33.3 ms | 18.8 ms |

Two things that look like they should fix this but measurably do not:

- **`PRAGMA optimize` alone** — writes `sqlite_stat1` rows, changes no plan.
- **`PRAGMA analysis_limit = 400`** (the usual "cheap ANALYZE" advice) —
  samples too coarsely to shift the planner; measured identical to having
  no statistics at all.

Only an unsampled `ANALYZE` works. It costs ~57 ms per 60k rows, so
`refreshQueryPlannerStats()` (`lib/server/db/startup.ts`, called after
migrations) runs it only when the row count the planner believes has
diverged from reality by 4x. Growth re-analyses at 4x, 16x, 64x … —
logarithmically often, at boot, never in a request path. A no-op boot
costs 0.3 ms.

### Net effect (20k rows)

| Benchmark | Before | After |
| --- | --- | --- |
| logs list page 1 (admin) | 1.32 ms | 1.06 ms |
| stats overview, 7-day | 19.8 ms | 15.7 ms |
| stats overview, 30-day | 61.3 ms | 47.9 ms |

### Paths that were already fast — left alone

- `parseStreamChunk` (per token) — ~100 ns, ~10M ops/s for every variant.
- `mergeParams` + `applyFieldFilter` (per request) — ~0.9 µs on a 40-turn
  body with 12 tools.
- `decryptSecret` (per request) — 5.7 µs.
- `SSEParser.parse` — well under the frame budget for realistic chunk sizes.

Deep pagination (`OFFSET 10000`, 5.4 ms) and leading-wildcard `LIKE`
(2.7 ms) are inherent to the access pattern, not fixable with an index,
and are not on a hot path.
