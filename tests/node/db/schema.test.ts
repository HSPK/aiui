// Schema-level guarantees.
//
// The index set is a performance contract, not decoration: the logs list and
// every stats aggregate depend on specific composites existing. A missing one
// degrades silently into a full scan that only shows up under production data
// volume, so assert the declared set and the migrated set agree.

import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type BetterSqlite3 from "better-sqlite3";
import { db, schema } from "@/lib/server/db";

const raw = (db as unknown as { $client: BetterSqlite3.Database }).$client;

const TABLES = [
    schema.users,
    schema.sessions,
    schema.apiKeys,
    schema.providers,
    schema.models,
    schema.conversations,
    schema.messages,
    schema.generationLogs,
    schema.userPreferences,
    schema.tools,
    schema.mcpServers,
];

/** Index names Drizzle declares, across every table. */
function declaredIndexes(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const table of TABLES) {
        const cfg = getTableConfig(table);
        for (const idx of cfg.indexes) {
            out.set(idx.config.name, idx.config.columns.map((c) => (c as { name: string }).name));
        }
    }
    return out;
}

/** Index names actually present in the migrated database. */
function migratedIndexes(): Set<string> {
    const rows = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
}

describe("database schema", () => {
    it("declares every table the application queries", () => {
        const migrated = new Set(
            (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
                .map((r) => r.name),
        );
        for (const table of TABLES) {
            expect(migrated).toContain(getTableConfig(table).name);
        }
    });

    it("has every declared index present in the migrated database", () => {
        const declared = declaredIndexes();
        const migrated = migratedIndexes();
        const missing = [...declared.keys()].filter((n) => !migrated.has(n));
        expect(missing).toEqual([]);
    });

    it("has no orphan indexes in the database that the schema no longer declares", () => {
        const declared = declaredIndexes();
        const migrated = migratedIndexes();
        // `.unique()` columns materialise as `<table>_<column>_unique` indexes
        // that Drizzle creates but doesn't surface via `config.indexes`.
        const uniques = new Set(
            TABLES.flatMap((table) => {
                const cfg = getTableConfig(table);
                return cfg.columns
                    .filter((c) => c.isUnique)
                    .map((c) => `${cfg.name}_${c.name}_unique`);
            }),
        );
        const orphans = [...migrated].filter((n) => !declared.has(n) && !uniques.has(n));
        expect(orphans).toEqual([]);
    });

    it("indexes generation_logs for the unfiltered admin view and the stats window", () => {
        // Regression guard: the three older composites all lead with a filter
        // column (user_id / capability / status), so none of them serves
        // `WHERE is_deleted = 0 ORDER BY created_at DESC` or the stats
        // `created_at >= ?` range. Losing this index silently reintroduces a
        // full scan on the default logs page.
        const declared = declaredIndexes();
        expect(declared.get("gen_logs_deleted_created_idx")).toEqual(["is_deleted", "created_at"]);
    });

    it("keeps the composite indexes the hot list queries rely on", () => {
        const declared = declaredIndexes();
        expect(declared.get("gen_logs_user_deleted_created_idx")).toEqual(["user_id", "is_deleted", "created_at"]);
        expect(declared.get("conversations_user_active_updated_idx")).toEqual(["user_id", "is_deleted", "updated_at"]);
        expect(declared.get("messages_conv_active_created_idx")).toEqual(["conversation_id", "is_active", "created_at"]);
        // Login purges expired sessions on every request — needs its own index.
        expect(declared.get("sessions_expires_idx")).toEqual(["expires_at"]);
    });

    it("cascades deletes from users so removing an account leaves no orphans", () => {
        for (const table of [schema.sessions, schema.apiKeys, schema.conversations, schema.generationLogs, schema.userPreferences]) {
            const fks = getTableConfig(table).foreignKeys;
            expect(fks.length).toBeGreaterThan(0);
            expect(fks.some((fk) => fk.onDelete === "cascade")).toBe(true);
        }
    });

    it("defaults timestamps to ISO-8601 with milliseconds and a Z suffix", () => {
        // Rows written by the app use `new Date().toISOString()`; a SQLite
        // default of `CURRENT_TIMESTAMP` would produce a different shape and
        // break client-side sort/dedupe by created_at.
        raw.exec("INSERT INTO tools (id, name) VALUES ('t-default', 'default_probe')");
        const row = raw.prepare("SELECT created_at FROM tools WHERE id = 't-default'").get() as { created_at: string };
        expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        raw.exec("DELETE FROM tools WHERE id = 't-default'");
    });
});
