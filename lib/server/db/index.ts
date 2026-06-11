import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { resetHealthCheckState } from "./startup";

const USER_CWD = process.env.LOOM_USER_CWD || process.cwd();
const DB_PATH = process.env.LOOM_DB_PATH || resolve(USER_CWD, "data", "loom.db");

declare global {
    var __loom_db__: ReturnType<typeof createDb> | undefined;
}

function createDb() {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const sqlite = new Database(DB_PATH);
    // WAL: many concurrent readers + one writer never block on each other.
    // NORMAL: fsync only on checkpoint (safe under WAL — at most lose the
    // last checkpoint window on power-loss, never corrupt the DB).
    // busy_timeout: wait up to 5s on a busy lock instead of throwing
    // SQLITE_BUSY immediately — the common case is a checkpoint window.
    // cache_size = -64000: 64 MB page cache (negative = KiB). Default
    // is ~2 MB which is far too small for the log/messages tables.
    // temp_store MEMORY: keep aggregate / sort scratch in RAM, not on
    // disk — stats endpoint does several GROUP BYs that benefit.
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("cache_size = -64000");
    sqlite.pragma("temp_store = MEMORY");
    // Note: foreign_keys is set AFTER migrations run — see below.

    const db = drizzle(sqlite, { schema });

    // Skip migrations when explicitly disabled OR during Next.js
    // production build's page-data collection. `next build` spawns
    // parallel workers per route — each imports server code and
    // triggers `createDb()` → `migrate()`. Concurrent CREATE TABLE
    // statements on the same SQLite file race past Drizzle's
    // transaction-tracked migration ledger and fail with SQLITE_ERROR
    // "table api_keys already exists" non-deterministically.
    //
    // Build scripts set `LOOM_SKIP_MIGRATIONS=1` explicitly; we also
    // honor `NEXT_PHASE === 'phase-production-build'` as a fallback
    // signal so adhoc `next build` outside our build script stays safe.
    // Migrations run at runtime startup (single process, no race).
    const skipMigrations =
        process.env.LOOM_SKIP_MIGRATIONS === "1" ||
        process.env.NEXT_PHASE === "phase-production-build";

    // Migrations live alongside the package source, not the user's
    // project. `LOOM_PACKAGE_ROOT` is set by the CLI; in dev (bun run
    // dev / next start from repo) it's absent and `process.cwd()`
    // happens to be the package root, so the fallback still works.
    const packageRoot = process.env.LOOM_PACKAGE_ROOT || process.cwd();
    const migrationsFolder = resolve(packageRoot, "drizzle");
    if (!skipMigrations && existsSync(migrationsFolder)) {
        // CRITICAL: foreign_keys MUST be OFF for the duration of any
        // "12-step table rebuild" migration (CREATE __new_X / COPY /
        // DROP X / RENAME). Drizzle wraps each migration in a BEGIN/
        // COMMIT, and `PRAGMA foreign_keys` is a SILENT NO-OP inside
        // a transaction — so a `PRAGMA foreign_keys=OFF` at the top
        // of the .sql file does nothing. With FK enforcement still
        // ON, every `DROP TABLE <parent>` cascade-deletes every
        // child row (api_keys, sessions, conversations → messages,
        // user_preferences, generation_logs, …). The toggle MUST
        // happen at the JS level, outside any tx.
        sqlite.pragma("foreign_keys = OFF");
        try {
            migrate(db, { migrationsFolder });
            // Audit before re-enabling — if any FK violation slipped
            // through (e.g. orphan row in a child table), surface it
            // loudly rather than silently re-enabling and crashing
            // later at runtime.
            const violations = sqlite.pragma("foreign_key_check") as unknown[];
            if (violations.length > 0) {
                console.error("[loom] foreign_key_check violations after migration:", violations);
            }
        } catch (err) {
            console.error("[loom] Failed to run migrations:", err);
            throw err;
        } finally {
            sqlite.pragma("foreign_keys = ON");
        }
    } else if (!skipMigrations) {
        sqlite.pragma("foreign_keys = ON");
    }

    // Post-migration startup tasks. Skipped during build phase since the
    // build doesn't talk to a real DB. Runs exactly once per process boot
    // because createDb is gated by the globalThis cache below.
    if (!skipMigrations) {
        resetHealthCheckState(db);
    }

    return db;
}

export const db = globalThis.__loom_db__ ?? createDb();
// Cache globally in ALL environments — multiple imports within the same
// process (Next.js dev HMR, build workers, production warm requests)
// should share the same connection. Per-process caching does NOT solve
// the multi-process migration race during `next build`; that's handled
// by the `isBuildPhase` skip inside `createDb`.
globalThis.__loom_db__ = db;

export { schema };
