#!/usr/bin/env node
// E2E: migration safety — verify that running the drizzle migrator
// against a populated DB preserves all user-owned rows. Regression
// guard for the v1.0.0 `0023_iso_default_timestamps.sql` data-loss
// bug, where the in-SQL `PRAGMA foreign_keys=OFF` was a no-op inside
// drizzle's tx and every `DROP TABLE <parent>` cascade-deleted child
// rows. The fix lives in `lib/server/db/index.ts` — FK toggle at the
// JS level around `migrate()`.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
    existsSync,
    unlinkSync,
    readFileSync,
    readdirSync,
    mkdtempSync,
    cpSync,
    mkdirSync,
    writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

// ---- bootstrap: bring a fresh DB up to one migration BEFORE the
//      latest, then seed every user-owned table.
const TMP_DB = join(mkdtempSync(join(tmpdir(), "loom-e2e-mig-")), "loom.db");
const allMigrations = readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort();
const journalAll = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf-8"));

// The "latest" migration we want to test applying — the one with the
// largest 4-digit prefix.
const LATEST = allMigrations[allMigrations.length - 1];
expect("latest migration discovered", !!LATEST, LATEST);
const LATEST_IDX = LATEST.slice(0, 4);

const phase1Dir = mkdtempSync(join(tmpdir(), "loom-e2e-mig-phase1-"));
mkdirSync(join(phase1Dir, "meta"), { recursive: true });
const phase1Journal = {
    ...journalAll,
    entries: journalAll.entries.filter((e) => e.tag.slice(0, 4) < LATEST_IDX),
};
writeFileSync(
    join(phase1Dir, "meta/_journal.json"),
    JSON.stringify(phase1Journal, null, 2),
);
for (const e of phase1Journal.entries) {
    const snap = `${e.tag.slice(0, 4)}_snapshot.json`;
    if (existsSync(`drizzle/meta/${snap}`)) {
        cpSync(`drizzle/meta/${snap}`, join(phase1Dir, "meta", snap));
    }
}
for (const f of allMigrations) {
    if (f.slice(0, 4) < LATEST_IDX) cpSync(`drizzle/${f}`, join(phase1Dir, f));
}

const sqlite = new Database(TMP_DB);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: phase1Dir });
expect("phase-1 migrations applied", true);

// Seed every user-owned table. Column names mirror schema.ts; if the
// schema changes the inserts MUST be updated.
try {
    sqlite.exec(`INSERT INTO users (id, username, password_hash) VALUES ('u1', 'alice', 'h')`);
    sqlite.exec(`INSERT INTO providers (id, name, base_url) VALUES ('p1', 'prov', 'http://x')`);
    sqlite.exec(`INSERT INTO models (id, provider_id, name, upstream_model_id) VALUES ('m1', 'p1', 'mn', 'mid')`);
    sqlite.exec(`INSERT INTO api_keys (id, user_id, name, prefix, key_hash) VALUES ('k1', 'u1', 'n', 'p', 'h')`);
    sqlite.exec(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 'u1', strftime('%s', 'now', '+1 day') * 1000)`);
    sqlite.exec(`INSERT INTO conversations (id, user_id) VALUES ('c1', 'u1')`);
    sqlite.exec(`INSERT INTO messages (id, conversation_id, role, content) VALUES ('msg1', 'c1', 'user', '"hi"')`);
    sqlite.exec(`INSERT INTO user_preferences (user_id, preferences) VALUES ('u1', '{}')`);
    sqlite.exec(`INSERT INTO generation_logs (id, user_id, model_name) VALUES ('g1', 'u1', 'test')`);
    expect("seeded all user-owned tables", true);
} catch (err) {
    expect("seeded all user-owned tables", false, err.message);
}

const tables = [
    "users",
    "providers",
    "models",
    "conversations",
    "messages",
    "sessions",
    "api_keys",
    "user_preferences",
    "generation_logs",
];

// ---- apply latest migration with the JS-level FK toggle (the
//      production fix in lib/server/db/index.ts). If the fix
//      regresses, table-rebuild migrations will CASCADE-wipe child
//      tables and the per-table assertions below will fail loudly.
sqlite.pragma("foreign_keys = OFF");
try {
    migrate(db, { migrationsFolder: resolve("drizzle") });
} catch (err) {
    expect("migration applied without error", false, err.message);
    process.exit(1);
} finally {
    const violations = sqlite.pragma("foreign_key_check");
    expect("no foreign_key_check violations", violations.length === 0,
        violations.length ? JSON.stringify(violations) : "");
    sqlite.pragma("foreign_keys = ON");
}
expect("migration applied without error", true);

for (const t of tables) {
    const c = sqlite.prepare(`SELECT count(*) as c FROM ${t}`).get().c;
    expect(`${t} row preserved after migration`, c >= 1, `count=${c}`);
}

const fkOn = sqlite.pragma("foreign_keys", { simple: true });
expect("foreign_keys re-enabled after migration", fkOn === 1, `got ${fkOn}`);

sqlite.close();
unlinkSync(TMP_DB);

// ---- summary ----
console.log("");
console.log(`${passed}/${expectations.length} expectations passed`);
if (passed !== expectations.length) process.exit(1);
