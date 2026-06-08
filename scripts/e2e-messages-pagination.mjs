#!/usr/bin/env node
// E2E: paginated /messages must return subtree-complete pages —
// when a page lands on tool rows whose parent assistant is in an
// older slice, the server walks the parent_id chain to include the
// ancestors. Without this, the FE fold drops orphan tool rows and
// the chat surface renders empty.
//
// Setup: directly INSERT a conversation with 1 user + 1 assistant
// (carrying tool_call parts) + 30 role:"tool" rows pointing back at
// the assistant. Request page 1 size 20. Assert: the response
// includes the parent assistant + the user, even though they aren't
// in the newest-20 window.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const SERVER_PORT = 19593;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-pgn-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
writeFileSync(path.join(tmp, ".config", "loom.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: pgnadmin
  password: pgnpass
`);

const server = spawn("bun", ["run", "next", "start", "-p", String(SERVER_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, LOOM_USER_CWD: tmp },
    stdio: ["ignore", "pipe", "pipe"],
});
let ready = false;
const serverLogs = [];
server.stdout.on("data", (d) => {
    const t = d.toString();
    serverLogs.push(t);
    if (t.includes("Ready") || t.includes("Local:")) ready = true;
});
server.stderr.on("data", (d) => serverLogs.push(d.toString()));

const cleanup = () => {
    try { server.kill("SIGTERM"); } catch { }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { }
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

try {
    const start = Date.now();
    while (!ready) {
        if (Date.now() - start > 30_000) throw new Error("server start timeout\n" + serverLogs.join(""));
        await sleep(200);
    }
    await sleep(400);

    // Login as admin.
    const login = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "pgnadmin", user_password: "pgnpass" }),
    });
    expect("login", login.status === 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

    // Find the admin's user id (we need it to insert via SQLite).
    const sqlite = await import("better-sqlite3");
    const dbPath = path.join(tmp, "data", "loom.db");
    const sdb = new sqlite.default(dbPath);
    const userRow = sdb.prepare("SELECT id FROM users WHERE username = ?").get("pgnadmin");
    const userId = userRow?.id;
    expect("admin user resolved", typeof userId === "string", `userId=${userId}`);

    const convId = randomUUID();
    const userMsgId = randomUUID();
    const assistantMsgId = randomUUID();

    const now = Date.now();
    const iso = (offsetMs) => new Date(now + offsetMs).toISOString();

    sdb.prepare(`
        INSERT INTO conversations (id, user_id, title, config, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(convId, userId, "tool-heavy turn", JSON.stringify({ model: "stub" }), iso(0), iso(0));

    sdb.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, model_id, generation_id, parent_id, is_active, created_at)
        VALUES (?, ?, 'user', ?, NULL, NULL, NULL, 1, ?)
    `).run(userMsgId, convId, JSON.stringify([{ type: "text", text: "please call many tools" }]), iso(1));

    // Assistant message with 30 tool_call parts (one per upcoming tool row).
    const TOOL_COUNT = 30;
    const callIds = Array.from({ length: TOOL_COUNT }, (_, i) => `tc_${i}`);
    const assistantContent = callIds.map((id, i) => ({
        type: "tool_call",
        tool_call: { id, name: `srv__op_${i}`, arguments: "{}", source: "srv" },
    }));
    sdb.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, model_id, generation_id, parent_id, is_active, created_at)
        VALUES (?, ?, 'assistant', ?, 'stub-model', 'log-stub', ?, 1, ?)
    `).run(assistantMsgId, convId, JSON.stringify(assistantContent), userMsgId, iso(2));

    // 30 tool result rows in chronological order after the assistant.
    const toolInsert = sdb.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, model_id, generation_id, parent_id, is_active, created_at)
        VALUES (?, ?, 'tool', ?, NULL, NULL, ?, 1, ?)
    `);
    for (let i = 0; i < TOOL_COUNT; i++) {
        toolInsert.run(
            randomUUID(),
            convId,
            JSON.stringify([{
                type: "tool_result",
                tool_result: { tool_call_id: callIds[i], name: `srv__op_${i}`, content: `result_${i}`, is_error: false, source: "srv" },
            }]),
            assistantMsgId,
            iso(10 + i),
        );
    }
    sdb.close();

    // Fetch page 1 / size 20 — the FE's default. Without ancestor
    // walk, the newest 20 are all tool rows; the assistant (#32 by
    // age, since toolCount + user + assistant = 32 rows; newest 20
    // are rows 12..31) is missing.
    const listRes = await fetch(`${BASE}/api/conversations/${convId}/messages?page=1&page_size=20&sort=-created_at`, {
        headers: { Cookie: cookie },
    });
    expect("list 200", listRes.status === 200);
    const body = await listRes.json();
    const items = body?.data?.items ?? [];

    const roles = items.map((m) => m.role);
    const ids = items.map((m) => m.id);

    expect("response includes the parent assistant despite age",
        ids.includes(assistantMsgId),
        `assistant_id_present=${ids.includes(assistantMsgId)} count=${items.length}`);
    expect("response includes the root user message via ancestor walk",
        ids.includes(userMsgId),
        `user_id_present=${ids.includes(userMsgId)}`);
    expect("response carries at least 1 assistant role row",
        roles.includes("assistant"),
        `roles=${roles.slice(0, 5).join(",")}…`);
    expect("response carries at least 1 user role row",
        roles.includes("user"),
        `roles=${roles.slice(-5).join(",")}…`);

    // Sanity: ALL tool rows come back, not just the newest 20.
    // Without descendant walk, the FE's ToolCallsList would show
    // 20 ok + 11 running for a 31-tool turn until the user loads
    // more — which is exactly the bug this commit fixes.
    const toolCount = roles.filter((r) => r === "tool").length;
    expect("descendant walk: all tool children of the loaded assistant come back",
        toolCount === TOOL_COUNT,
        `tool_count=${toolCount}/${TOOL_COUNT}`);

    // total reflects the underlying count BEFORE ancestor expansion
    // — page semantics stay sane for the FE pagination math.
    expect("total reflects raw row count (32), not the expanded list",
        body?.data?.total === TOOL_COUNT + 2,
        `total=${body?.data?.total}`);

    console.log(`\n${passed}/${expectations.length} expectations passed`);
    process.exit(passed === expectations.length ? 0 : 1);
} catch (err) {
    console.error("\nE2E FAILED:", err.message);
    console.error("\n--- server logs ---\n" + serverLogs.join(""));
    process.exit(1);
}
