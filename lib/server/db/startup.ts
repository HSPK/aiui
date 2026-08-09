import "server-only";
import { sql } from "drizzle-orm";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { mcpServers, providers } from "./schema";
import type { db as Db } from "./index";

/**
 * One-shot post-migration startup tasks.
 *
 * Reset all health-check state so that pills don't show stale `ok` / `down`
 * pulled in from before the restart. The actual provider / MCP server
 * might be in a totally different state right now (e.g., admin restarted
 * because they fixed a misconfig that previously failed). Showing the
 * pre-restart status is misleading and historically led to "why is this
 * green when it's clearly broken" support questions.
 *
 * Strategy: NULL out `last_*_status` / `last_*_at` / `last_*_error` on
 * boot. The pills then show "Never checked" until either:
 *   1. The admin clicks a "Check all" / per-row "Refresh" button, or
 *   2. `<AutoHealthChecks />` (mounted in the dashboard layout) fires
 *      its first sweep — which it does immediately on dashboard mount
 *      if it detects any enabled row with null check timestamps.
 *
 * Runs exactly once per process boot via the `globalThis.__loom_db__`
 * cache gate in `db/index.ts`. Cheap (two indexed UPDATEs).
 */
export function resetHealthCheckState(db: typeof Db): void {
    try {
        db.update(providers).set({
            lastHealthStatus: null,
            lastHealthCheckedAt: null,
            lastHealthError: null,
        }).run();
        db.update(mcpServers).set({
            lastCheckStatus: null,
            lastCheckAt: null,
            lastCheckError: null,
        }).run();
    } catch (err) {
        // Non-fatal — startup should not abort if the wipe fails (e.g.,
        // schema column rename in flight). Surface so it's visible in
        // logs but keep going.
        console.warn("[loom] failed to reset health-check state on startup:", err);
    }
    // Touch sql() so the import is used in type space even when the
    // implementation is just plain Drizzle updates (future-proof for
    // raw SQL fallbacks).
    void sql;
}

/**
 * Keep the query planner's statistics fresh.
 *
 * `generation_logs` carries nine indexes. Without an up-to-date
 * `sqlite_stat1` SQLite has to guess which one to use, and it guesses badly
 * once several candidates are plausible — it pins the logs-list `COUNT(*)`
 * and the stats aggregates to an index that forces a per-row table lookup.
 * Measured on a 60k-row table:
 *
 *   logs list COUNT + `model_name LIKE`   21.8 ms -> 6.6 ms
 *   stats totals                          20.7 ms -> 6.5 ms
 *   stats GROUP BY model                  33.3 ms -> 18.8 ms
 *
 * Two things that look like they should work, but don't:
 *
 *   - `PRAGMA optimize` on its own writes `sqlite_stat1` rows but does not
 *     change any of the plans above.
 *   - `PRAGMA analysis_limit = 400` (the usual "cheap ANALYZE" advice)
 *     samples too coarsely to shift the planner here — measured identical
 *     to having no statistics at all.
 *
 * Only an unsampled `ANALYZE` works, and that costs ~57 ms per 60k rows, so
 * we don't want it on every boot of a large database. Instead we compare the
 * row count the planner currently believes against reality and re-analyse
 * only when they have diverged by 4x. Growth therefore triggers an ANALYZE
 * at 4x, 16x, 64x ... — logarithmically often, and never in a request path.
 */
const STATS_STALENESS_FACTOR = 4;

export function refreshQueryPlannerStats(db: typeof Db): void {
    try {
        // Use the raw handle: `PRAGMA optimize` may or may not return rows
        // depending on build options, and Drizzle's `.run()` throws when a
        // statement yields data. `exec`/`pragma` don't care either way.
        const sqlite = (db as unknown as { $client: BetterSqlite3Database }).$client;

        // Nothing to analyse before the first migration has created the table
        // (fresh install, or a deployment missing its drizzle/ folder). Bail
        // quietly rather than warning about a state that isn't an error.
        const tables = sqlite
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('generation_logs', 'sqlite_stat1')",
            )
            .all() as Array<{ name: string }>;
        const names = new Set(tables.map((t) => t.name));
        if (!names.has("generation_logs")) return;
        const hasStatsTable = names.has("sqlite_stat1");

        // sqlite_stat1.stat is a space-separated string whose first token is
        // the row count ANALYZE recorded for that table.
        let believedRows = 0;
        if (hasStatsTable) {
            const row = sqlite
                .prepare("SELECT stat FROM sqlite_stat1 WHERE tbl = 'generation_logs' LIMIT 1")
                .get() as { stat: string } | undefined;
            believedRows = row ? Number(String(row.stat).split(" ")[0]) || 0 : 0;
        }

        const actualRows = (sqlite
            .prepare("SELECT count(*) AS n FROM generation_logs")
            .get() as { n: number }).n;

        const stale =
            believedRows === 0
                ? actualRows > 0
                : actualRows > believedRows * STATS_STALENESS_FACTOR ||
                  believedRows > actualRows * STATS_STALENESS_FACTOR;

        if (stale) {
            sqlite.pragma("analysis_limit = 0");
            sqlite.exec("ANALYZE");
        } else {
            sqlite.pragma("optimize");
        }
    } catch (err) {
        // Purely an optimisation — a failure here must never block boot.
        console.warn("[loom] failed to refresh query planner statistics:", err);
    }
}
