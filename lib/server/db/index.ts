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
    sqlite.pragma("journal_mode = WAL");
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
