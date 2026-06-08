# Request logs

Every call that touches Loom — gateway, playground, MCP tool dispatch — produces one row in `generation_logs`. The `/logs` page exposes the full table with filters, replay, and detail panels.

## What gets recorded

For every request:

| Field                   | Notes                                                 |
| ----------------------- | ----------------------------------------------------- |
| Timestamp               | ISO-8601 with millisecond precision                   |
| Capability              | chat / embedding / rerank / image / audio / …         |
| Provider + model        | The actual upstream that served the request          |
| User + API key          | Which key issued the call                            |
| Prompt summary          | Truncated message preview for at-a-glance scanning   |
| Token usage             | Prompt / completion / total                          |
| TTFT                    | First-token latency (streaming only)                 |
| Total latency           | End-to-end                                           |
| Status                  | success / error                                      |
| Error class             | When status is error                                 |
| Tool calls              | Tool name, args, result, source MCP server           |

The full request payload + full response payload are stored verbatim and accessible from the detail drawer. Streamed responses are reassembled from the captured chunks so you can replay a stream in its entirety.

## Filters

The toolbar supports:

- Date range
- User
- Provider
- Model
- Capability
- Status
- API key
- Free-text search across prompts and responses

## Detail drawer

Click any row to open the side panel:

- **Request** — pretty-printed JSON of the upstream call
- **Response** — pretty-printed JSON of the upstream reply (streamed responses are reassembled)
- **Tool calls** — every MCP dispatch with its full input / output
- **Markdown preview** — toggle between rendered Markdown and raw text for any message body
- **Copy** — every JSON block has a one-click copy button

## Retention

Logs are unbounded by default — they grow with usage. If you need to cap retention, run a periodic cleanup like:

```sql
DELETE FROM generation_logs WHERE created_at < datetime('now', '-30 days');
```

(A built-in retention policy is on the [roadmap](https://github.com/HSPK/loom/issues).)

## Why this matters

Most gateway products either drop request logs entirely or push them to an external SaaS that bills per event. Loom records everything locally to SQLite; querying and exporting is a `sqlite3` away.

```bash
sqlite3 data/loom.db '
  SELECT model, count(*) AS n, avg(total_latency_ms) AS avg_ms
  FROM generation_logs
  WHERE created_at > datetime("now", "-7 days")
  GROUP BY model ORDER BY n DESC LIMIT 20;
'
```
