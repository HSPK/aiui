// `lib/server/db/index.ts` opens SQLite and runs migrations at module
// evaluation time, so every branch has to be driven through a fresh module
// registry with different environment variables.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..", "..");
let scratch: string;
const savedEnv = { ...process.env };

async function loadDb(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return import("@/lib/server/db");
}

function tableNames(mod: { db: unknown }): string[] {
    const raw = (mod.db as { $client: BetterSqlite3.Database }).$client;
    return (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((r) => r.name);
}

beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "loom-dbidx-"));
    delete globalThis.__loom_db__;
});

afterEach(() => {
    delete globalThis.__loom_db__;
    process.env = { ...savedEnv };
    rmSync(scratch, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("db module bootstrap", () => {
    it("creates the parent directory of a database path that doesn't exist yet", async () => {
        const nested = join(scratch, "deep", "nested", "loom.db");
        expect(existsSync(join(scratch, "deep"))).toBe(false);

        await loadDb({ LOOM_DB_PATH: nested, LOOM_PACKAGE_ROOT: PACKAGE_ROOT, LOOM_SKIP_MIGRATIONS: undefined });

        expect(existsSync(nested)).toBe(true);
    });

    it("runs migrations and enables foreign keys on a fresh database", async () => {
        const mod = await loadDb({
            LOOM_DB_PATH: join(scratch, "loom.db"),
            LOOM_PACKAGE_ROOT: PACKAGE_ROOT,
            LOOM_SKIP_MIGRATIONS: undefined,
        });

        expect(tableNames(mod)).toEqual(expect.arrayContaining(["users", "providers", "generation_logs"]));
        const raw = (mod.db as unknown as { $client: BetterSqlite3.Database }).$client;
        expect(raw.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(raw.pragma("journal_mode", { simple: true })).toBe("wal");
    });

    it("skips migrations when LOOM_SKIP_MIGRATIONS=1", async () => {
        const mod = await loadDb({
            LOOM_DB_PATH: join(scratch, "loom.db"),
            LOOM_PACKAGE_ROOT: PACKAGE_ROOT,
            LOOM_SKIP_MIGRATIONS: "1",
        });

        expect(tableNames(mod)).not.toContain("users");
    });

    it("skips migrations during the Next.js production build phase", async () => {
        const mod = await loadDb({
            LOOM_DB_PATH: join(scratch, "loom.db"),
            LOOM_PACKAGE_ROOT: PACKAGE_ROOT,
            LOOM_SKIP_MIGRATIONS: undefined,
            NEXT_PHASE: "phase-production-build",
        });

        expect(tableNames(mod)).not.toContain("users");
    });

    it("enables foreign keys even when the migrations folder is absent", async () => {
        const emptyRoot = join(scratch, "no-drizzle");
        mkdirSync(emptyRoot, { recursive: true });

        const mod = await loadDb({
            LOOM_DB_PATH: join(scratch, "loom.db"),
            LOOM_PACKAGE_ROOT: emptyRoot,
            LOOM_SKIP_MIGRATIONS: undefined,
        });

        const raw = (mod.db as unknown as { $client: BetterSqlite3.Database }).$client;
        expect(raw.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(tableNames(mod)).not.toContain("users");
    });

    it("defaults to <cwd>/data/loom.db when LOOM_DB_PATH is unset", async () => {
        await loadDb({
            LOOM_DB_PATH: undefined,
            LOOM_USER_CWD: scratch,
            LOOM_PACKAGE_ROOT: PACKAGE_ROOT,
            LOOM_SKIP_MIGRATIONS: "1",
        });

        expect(existsSync(join(scratch, "data", "loom.db"))).toBe(true);
    });

    it("reuses the cached connection across imports within one process", async () => {
        const first = await loadDb({
            LOOM_DB_PATH: join(scratch, "loom.db"),
            LOOM_PACKAGE_ROOT: PACKAGE_ROOT,
            LOOM_SKIP_MIGRATIONS: "1",
        });
        const second = await import("@/lib/server/db");

        expect(second.db).toBe(first.db);
        expect(globalThis.__loom_db__).toBe(first.db);
    });

    it("surfaces a migration failure instead of booting with a half-built schema", async () => {
        const badRoot = join(scratch, "bad-migrations");
        mkdirSync(join(badRoot, "drizzle", "meta"), { recursive: true });
        // A journal referencing a migration file that doesn't exist.
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
            join(badRoot, "drizzle", "meta", "_journal.json"),
            JSON.stringify({ version: "7", dialect: "sqlite", entries: [{ idx: 0, version: "6", when: 1, tag: "0000_missing", breakpoints: true }] }),
        );
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(
            loadDb({
                LOOM_DB_PATH: join(scratch, "loom.db"),
                LOOM_PACKAGE_ROOT: badRoot,
                LOOM_SKIP_MIGRATIONS: undefined,
            }),
        ).rejects.toThrow();

        expect(error).toHaveBeenCalledWith("[loom] Failed to run migrations:", expect.anything());
    });
});
