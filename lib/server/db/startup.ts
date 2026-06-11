import "server-only";
import { sql } from "drizzle-orm";
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
