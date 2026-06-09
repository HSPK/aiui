import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

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
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, { schema });

    // Migrations live alongside the package source, not the user's
    // project. `LOOM_PACKAGE_ROOT` is set by the CLI; in dev (bun run
    // dev / next start from repo) it's absent and `process.cwd()`
    // happens to be the package root, so the fallback still works.
    const packageRoot = process.env.LOOM_PACKAGE_ROOT || process.cwd();
    const migrationsFolder = resolve(packageRoot, "drizzle");
    if (existsSync(migrationsFolder)) {
        try {
            migrate(db, { migrationsFolder });
        } catch (err) {
            console.error("[loom] Failed to run migrations:", err);
            throw err;
        }
    }

    return db;
}

export const db = globalThis.__loom_db__ ?? createDb();
if (process.env.NODE_ENV !== "production") {
    globalThis.__loom_db__ = db;
}

export { schema };
