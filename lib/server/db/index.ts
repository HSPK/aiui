import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const DB_PATH = process.env.AIUI_DB_PATH || resolve(process.cwd(), "data", "aiui.db");

declare global {
    var __aiui_db__: ReturnType<typeof createDb> | undefined;
}

function createDb() {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, { schema });

    const migrationsFolder = resolve(process.cwd(), "drizzle");
    if (existsSync(migrationsFolder)) {
        try {
            migrate(db, { migrationsFolder });
        } catch (err) {
            console.error("[aiui] Failed to run migrations:", err);
            throw err;
        }
    }

    return db;
}

export const db = globalThis.__aiui_db__ ?? createDb();
if (process.env.NODE_ENV !== "production") {
    globalThis.__aiui_db__ = db;
}

export { schema };
