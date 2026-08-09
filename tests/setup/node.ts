// Per-test-file environment for the `node` project.
//
// Runs BEFORE the test file's own imports, which matters because
// lib/server/db/index.ts reads LOOM_DB_PATH and opens SQLite at module
// evaluation time. Each test file gets its own database file so suites
// can seed freely without cross-talk.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "loom-test-"));

process.env.LOOM_DB_PATH = join(dir, "loom.db");
process.env.LOOM_MASTER_KEY ??= "test-master-key-do-not-use-in-production";
process.env.LOOM_USER_CWD = dir;
// Migrations resolve against LOOM_PACKAGE_ROOT/drizzle.
process.env.LOOM_PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");
// Keep the admin bootstrap out of the way; suites create their own users.
delete process.env.LOOM_ADMIN_PASSWORD;

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});
