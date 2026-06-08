#!/usr/bin/env node
// E2E: MCP server validation lifecycle.
//   1. Create an MCP server backed by a real stdio child — the
//      background check populates last_check_status=ok + tools_cache.
//   2. Create one backed by a missing binary — the check populates
//      status=error + last_check_error.
//   3. Explicit POST /check on the broken one — still error, but the
//      tools_cache from the working case (if any) survives.
//   4. PATCH the broken one's config to point at a working child;
//      next /check returns ok.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const SERVER_PORT = 19582;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

const tmp = mkdtempSync(path.join(tmpdir(), "aiui-e2e-mcpchk-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
writeFileSync(path.join(tmp, ".config", "aiui.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: chkadmin
  password: chkpass
`);

const mcpServerPath = path.join(tmp, "mcp-add.mjs");
writeFileSync(mcpServerPath, `
import { Server } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

const server = new Server({ name: "tiny", version: "0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        { name: "ping", description: "Returns pong", inputSchema: { type: "object", properties: {}, required: [] } },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "pong" }] }));
await server.connect(new StdioServerTransport());
`);

const server = spawn("bun", ["run", "next", "start", "-p", String(SERVER_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, AIUI_USER_CWD: tmp },
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
    try { server.kill("SIGTERM"); } catch {}
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
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

    const login = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "chkadmin", user_password: "chkpass" }),
    });
    expect("login", login.status === 200, `status=${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

    // ---- 1. happy-path create ----
    const goodRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "good", description: "", transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: true,
        }),
    });
    expect("create good 200", goodRes.status === 200, `status=${goodRes.status}`);
    const goodId = (await goodRes.json()).data?.id;

    // Background check should complete within a few seconds.
    let goodDTO = null;
    for (let i = 0; i < 30; i++) {
        await sleep(300);
        const r = await fetch(`${BASE}/api/mcp/servers/${goodId}`, { headers: { Cookie: cookie } });
        goodDTO = (await r.json()).data;
        if (goodDTO?.last_check_status) break;
    }
    expect("good server: background check writes status=ok",
        goodDTO?.last_check_status === "ok",
        `status=${goodDTO?.last_check_status} err=${goodDTO?.last_check_error}`);
    expect("good server: tools_cache populated by initialize handshake",
        Array.isArray(goodDTO?.tools_cache) && goodDTO.tools_cache.some((t) => t.name === "ping"),
        `tools=${JSON.stringify(goodDTO?.tools_cache)}`);
    expect("good server: last_check_at is set", typeof goodDTO?.last_check_at === "string");

    // ---- 2. failure-path create ----
    const badRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "bad", description: "", transport: "stdio",
            config: { command: "node", args: ["/nonexistent/does-not-exist.mjs"] },
            enabled: true,
        }),
    });
    expect("create bad 200", badRes.status === 200, `status=${badRes.status}`);
    const badId = (await badRes.json()).data?.id;

    let badDTO = null;
    for (let i = 0; i < 30; i++) {
        await sleep(300);
        const r = await fetch(`${BASE}/api/mcp/servers/${badId}`, { headers: { Cookie: cookie } });
        badDTO = (await r.json()).data;
        if (badDTO?.last_check_status) break;
    }
    expect("bad server: background check writes status=error",
        badDTO?.last_check_status === "error",
        `status=${badDTO?.last_check_status}`);
    expect("bad server: last_check_error captured",
        typeof badDTO?.last_check_error === "string" && badDTO.last_check_error.length > 0,
        `err=${badDTO?.last_check_error}`);

    // ---- 3. explicit check endpoint ----
    const recheckRes = await fetch(`${BASE}/api/mcp/servers/${badId}/check`, {
        method: "POST", headers: { Cookie: cookie },
    });
    expect("POST /check returns 200", recheckRes.status === 200);
    const rechecked = (await recheckRes.json()).data;
    expect("explicit check still reports error",
        rechecked?.last_check_status === "error",
        `status=${rechecked?.last_check_status}`);

    // ---- 4. fix the bad server, check passes ----
    const fixRes = await fetch(`${BASE}/api/mcp/servers/${badId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
        }),
    });
    expect("PATCH bad → working 200", fixRes.status === 200, `status=${fixRes.status}`);

    let fixedDTO = null;
    for (let i = 0; i < 30; i++) {
        await sleep(300);
        const r = await fetch(`${BASE}/api/mcp/servers/${badId}`, { headers: { Cookie: cookie } });
        fixedDTO = (await r.json()).data;
        if (fixedDTO?.last_check_status === "ok") break;
    }
    expect("after fix: background check writes status=ok",
        fixedDTO?.last_check_status === "ok",
        `status=${fixedDTO?.last_check_status}`);
    expect("after fix: tools_cache replaced", Array.isArray(fixedDTO?.tools_cache) && fixedDTO.tools_cache.length > 0,
        `tools_cache_len=${fixedDTO?.tools_cache?.length}`);

    // ---- 5. env encryption round-trip ----
    // Write a tiny child whose `whoami` tool returns the env var
    // SECRET_TOKEN it was spawned with. Verify (a) the DTO surfaces
    // the plaintext env to the admin form, (b) the connection picks
    // up the value correctly (tool returns it), (c) the DB row's
    // config blob is ciphertext for that field (the AIUI_MASTER_KEY
    // hash is required to read it back).
    const secretChildPath = path.join(tmp, "mcp-secret.mjs");
    writeFileSync(secretChildPath, `
import { Server } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

const server = new Server({ name: "secret", version: "0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "whoami", description: "Returns SECRET_TOKEN env value", inputSchema: { type: "object", properties: {}, required: [] } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: "text", text: process.env.SECRET_TOKEN ?? "<missing>" }],
}));
await server.connect(new StdioServerTransport());
`);

    const SECRET = "s3cr3t-" + Math.random().toString(36).slice(2);
    const secretSrvRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "secrets", description: "", transport: "stdio",
            config: {
                command: "node",
                args: [secretChildPath],
                env: { SECRET_TOKEN: SECRET },
            },
            enabled: true,
        }),
    });
    expect("create secrets 200", secretSrvRes.status === 200, `status=${secretSrvRes.status}`);
    const secretsId = (await secretSrvRes.json()).data?.id;

    // Wait for background check + tool discovery.
    let secretsDTO = null;
    for (let i = 0; i < 30; i++) {
        await sleep(300);
        const r = await fetch(`${BASE}/api/mcp/servers/${secretsId}`, { headers: { Cookie: cookie } });
        secretsDTO = (await r.json()).data;
        if (secretsDTO?.last_check_status === "ok") break;
    }
    expect("secrets server: check ok", secretsDTO?.last_check_status === "ok",
        `status=${secretsDTO?.last_check_status} err=${secretsDTO?.last_check_error}`);

    expect("DTO surfaces env in plaintext (admin-facing)",
        secretsDTO?.config?.env?.SECRET_TOKEN === SECRET,
        `got=${secretsDTO?.config?.env?.SECRET_TOKEN}`);

    // Inspect DB row via better-sqlite3 — it's the only way to verify
    // the ciphertext (the API route always decrypts on serialize).
    const sqlite = await import("better-sqlite3");
    const dbPath = path.join(tmp, "data", "aiui.db");
    const sdb = new sqlite.default(dbPath, { readonly: true });
    const row = sdb.prepare("SELECT config FROM mcp_servers WHERE id = ?").get(secretsId);
    sdb.close();
    const stored = JSON.parse(row?.config ?? "{}");
    const storedEnv = stored?.env?.SECRET_TOKEN ?? "";
    expect("DB row stores env value with enc:v1: sentinel (ciphertext on disk)",
        typeof storedEnv === "string" && storedEnv.startsWith("enc:v1:"),
        `stored=${String(storedEnv).slice(0, 32)}…`);
    expect("DB row's ciphertext does NOT contain the plaintext secret",
        typeof storedEnv === "string" && !storedEnv.includes(SECRET),
        `stored_len=${String(storedEnv).length}`);

    console.log(`\n${passed}/${expectations.length} expectations passed`);
    process.exit(passed === expectations.length ? 0 : 1);
} catch (err) {
    console.error("\nE2E FAILED:", err.message);
    console.error("\n--- server logs ---\n" + serverLogs.join(""));
    process.exit(1);
}
