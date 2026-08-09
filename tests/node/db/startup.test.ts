import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import { db, schema } from "@/lib/server/db";
import { refreshQueryPlannerStats, resetHealthCheckState } from "@/lib/server/db/startup";
import { resetDb, seedMcpServer, seedProvider, seedUser } from "../../helpers/db";

const raw = (db as unknown as { $client: BetterSqlite3.Database }).$client;

/** Rows the planner currently believes `generation_logs` holds. */
function believedRows(): number | null {
    const hasTable = (raw
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'")
        .get() as { n: number }).n > 0;
    if (!hasTable) return null;
    const row = raw
        .prepare("SELECT stat FROM sqlite_stat1 WHERE tbl = 'generation_logs' LIMIT 1")
        .get() as { stat: string } | undefined;
    return row ? Number(String(row.stat).split(" ")[0]) : 0;
}

function insertLogs(count: number): void {
    const user = seedUser();
    const stmt = raw.prepare(
        `INSERT INTO generation_logs (id, user_id, model_name, status, is_deleted, created_at, updated_at)
         VALUES (?, ?, 'm', 'completed', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    const tx = raw.transaction(() => {
        for (let i = 0; i < count; i++) stmt.run(`log-${i}-${Math.random()}`, user.id);
    });
    tx();
}

describe("resetHealthCheckState", () => {
    beforeEach(() => resetDb());

    it("clears stale provider and MCP health state so pills don't show pre-restart status", () => {
        seedProvider({
            lastHealthStatus: "ok",
            lastHealthCheckedAt: "2026-01-01T00:00:00.000Z",
            lastHealthError: "boom",
        });
        seedMcpServer({
            lastCheckStatus: "error",
            lastCheckAt: "2026-01-01T00:00:00.000Z",
            lastCheckError: "boom",
        });

        resetHealthCheckState(db);

        const p = db.select().from(schema.providers).all()[0];
        expect(p.lastHealthStatus).toBeNull();
        expect(p.lastHealthCheckedAt).toBeNull();
        expect(p.lastHealthError).toBeNull();

        const m = db.select().from(schema.mcpServers).all()[0];
        expect(m.lastCheckStatus).toBeNull();
        expect(m.lastCheckAt).toBeNull();
        expect(m.lastCheckError).toBeNull();
    });

    it("swallows and warns instead of aborting boot when the update fails", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const broken = {
            update: () => { throw new Error("schema migration in flight"); },
        } as unknown as typeof db;

        expect(() => resetHealthCheckState(broken)).not.toThrow();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("failed to reset health-check state"),
            expect.any(Error),
        );
        warn.mockRestore();
    });
});

describe("refreshQueryPlannerStats", () => {
    beforeEach(() => {
        resetDb();
        raw.exec("DROP TABLE IF EXISTS sqlite_stat1");
    });

    afterEach(() => vi.restoreAllMocks());

    it("does not ANALYZE an empty database — there is nothing worth sampling", () => {
        refreshQueryPlannerStats(db);
        // PRAGMA optimize on an empty db must not fabricate statistics.
        expect(believedRows()).toBeNull();
    });

    it("ANALYZEs on first boot once rows exist", () => {
        insertLogs(200);
        expect(believedRows()).toBeNull();

        refreshQueryPlannerStats(db);

        expect(believedRows()).toBe(200);
    });

    it("re-ANALYZEs after the table grows beyond the staleness factor", () => {
        insertLogs(100);
        refreshQueryPlannerStats(db);
        expect(believedRows()).toBe(100);

        insertLogs(400); // 5x -> past the 4x threshold
        refreshQueryPlannerStats(db);

        expect(believedRows()).toBe(500);
    });

    it("re-ANALYZEs after the table shrinks beyond the staleness factor", () => {
        insertLogs(500);
        refreshQueryPlannerStats(db);
        expect(believedRows()).toBe(500);

        raw.exec("DELETE FROM generation_logs");
        insertLogs(10); // believed 500 > 10*4
        refreshQueryPlannerStats(db);

        expect(believedRows()).toBe(10);
    });

    it("skips the expensive ANALYZE while statistics are still representative", () => {
        insertLogs(100);
        refreshQueryPlannerStats(db);
        expect(believedRows()).toBe(100);

        insertLogs(100); // 2x — inside the 4x tolerance
        refreshQueryPlannerStats(db);

        // Untouched: PRAGMA optimize alone must not rewrite the row estimate.
        expect(believedRows()).toBe(100);
    });

    it("is idempotent — a second call on fresh statistics changes nothing", () => {
        insertLogs(300);
        refreshQueryPlannerStats(db);
        const first = believedRows();

        refreshQueryPlannerStats(db);

        expect(believedRows()).toBe(first);
    });

    it("treats statistics that exist but say nothing about generation_logs as stale", () => {
        // ANALYZE while generation_logs is empty: sqlite_stat1 gets created for
        // other tables but carries no row for ours, so `believedRows` is 0 even
        // though the table is now populated.
        seedUser();
        raw.exec("ANALYZE");
        expect(believedRows()).toBe(0);

        insertLogs(150);
        refreshQueryPlannerStats(db);

        expect(believedRows()).toBe(150);
    });

    it("treats an unparseable stat row as no information and re-ANALYZEs", () => {
        insertLogs(120);
        refreshQueryPlannerStats(db);
        // Corrupt the recorded estimate so `Number(...)` yields NaN.
        raw.prepare("UPDATE sqlite_stat1 SET stat = 'garbage' WHERE tbl = 'generation_logs'").run();

        refreshQueryPlannerStats(db);

        expect(believedRows()).toBe(120);
    });

    it("stays quiet before the first migration has created generation_logs", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        raw.exec("ALTER TABLE generation_logs RENAME TO generation_logs_hidden");
        try {
            expect(() => refreshQueryPlannerStats(db)).not.toThrow();
            expect(warn).not.toHaveBeenCalled();
            expect(believedRows()).toBeNull();
        } finally {
            raw.exec("ALTER TABLE generation_logs_hidden RENAME TO generation_logs");
        }
    });

    it("warns and continues when the database rejects the statistics query", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const broken = {
            $client: {
                prepare: () => { throw new Error("database is locked"); },
            },
        } as unknown as typeof db;

        expect(() => refreshQueryPlannerStats(broken)).not.toThrow();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("failed to refresh query planner statistics"),
            expect.any(Error),
        );
        warn.mockRestore();
    });

    it("leaves the planner able to use the (is_deleted, created_at) index", () => {
        insertLogs(500);
        refreshQueryPlannerStats(db);

        const plan = raw
            .prepare(
                "EXPLAIN QUERY PLAN SELECT id FROM generation_logs WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 20",
            )
            .all() as Array<{ detail: string }>;

        expect(plan.map((r) => r.detail).join(" ")).toContain("gen_logs_deleted_created_idx");
    });
});
