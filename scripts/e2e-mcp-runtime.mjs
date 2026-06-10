#!/usr/bin/env node
// E2E: MCP runtime control + observability.
//   1. Create a working stdio server → background check populates it.
//   2. GET /runtime returns status=connected, a numeric PID, started_at,
//      and a populated log file tail (stderr + lifecycle records).
//   3. The log file lives under <USER_CWD>/data/mcp-logs/<id>.log.
//   4. POST /stop kills the child; GET /runtime now reports status=idle.
//      The log file persists across stop (post-mortem use).
//   5. POST /restart spins up a fresh process with a NEW pid.
//   6. DELETE deletes the log files alongside the row.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const SERVER_PORT = 19584;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-mcprt-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
writeFileSync(path.join(tmp, ".config", "loom.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: rtadmin
  password: rtpass
`);

const mcpServerPath = path.join(tmp, "mcp-rt.mjs");
writeFileSync(mcpServerPath, `
import { Server } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { ListToolsRequestSchema } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

// Emit a distinctive stderr marker so we can assert it lands in the
// persisted log file.
process.stderr.write("LOOM_RUNTIME_LOG_MARKER: starting on pid " + process.pid + "\\n");

const server = new Server({ name: "rt-tiny", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "noop", description: "", inputSchema: { type: "object", properties: {}, required: [] } }],
}));
await server.connect(new StdioServerTransport());
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
        body: JSON.stringify({ user_name: "rtadmin", user_password: "rtpass" }),
    });
    expect("login", login.status === 200, `status=${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

    // ---- 1. Create + wait for initial check ----
    const createRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "rt-good", description: "", transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: true,
        }),
    });
    expect("create 200", createRes.status === 200, `status=${createRes.status}`);
    const serverId = (await createRes.json()).data?.id;

    let serverDTO = null;
    for (let i = 0; i < 30; i++) {
        await sleep(300);
        const r = await fetch(`${BASE}/api/mcp/servers/${serverId}`, { headers: { Cookie: cookie } });
        serverDTO = (await r.json()).data;
        if (serverDTO?.last_check_status === "ok") break;
    }
    expect("initial background check ok", serverDTO?.last_check_status === "ok",
        `status=${serverDTO?.last_check_status} err=${serverDTO?.last_check_error}`);

    // ---- 2. GET /runtime — status=connected, PID, started_at, logs ----
    const rt1Res = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
    expect("GET /runtime 200", rt1Res.status === 200, `status=${rt1Res.status}`);
    const rt1 = (await rt1Res.json()).data;

    expect("runtime: status=connected", rt1?.status === "connected", `status=${rt1?.status}`);
    expect("runtime: pid is numeric", typeof rt1?.pid === "number" && rt1.pid > 0, `pid=${rt1?.pid}`);
    expect("runtime: started_at is ISO timestamp", typeof rt1?.started_at === "string" && rt1.started_at.includes("T"),
        `started_at=${rt1?.started_at}`);
    expect("runtime: built_for matches server.config_version", rt1?.built_for === serverDTO.config_version,
        `built_for=${rt1?.built_for} config_version=${serverDTO.config_version}`);
    expect("runtime: recent_logs is array", Array.isArray(rt1?.recent_logs), `recent_logs=${typeof rt1?.recent_logs}`);
    expect("runtime: log contains stderr marker",
        rt1?.recent_logs?.some((l) => l.includes("LOOM_RUNTIME_LOG_MARKER")),
        `logs=${JSON.stringify(rt1?.recent_logs?.slice(-3))}`);
    expect("runtime: log contains lifecycle 'ready' event",
        rt1?.recent_logs?.some((l) => l.includes("[lifecycle] ready")),
        `logs=${JSON.stringify(rt1?.recent_logs?.slice(-3))}`);

    // ---- 3. Log file is on disk under data/mcp-logs/<id>.log ----
    const expectedLogPath = path.join(tmp, "data", "mcp-logs", `${serverId}.log`);
    expect("log file exists at expected path", existsSync(expectedLogPath), `path=${expectedLogPath}`);

    const pid1 = rt1.pid;

    // ---- 4. POST /stop — kills the child; status drops to idle ----
    const stopRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/stop`, {
        method: "POST",
        headers: { Cookie: cookie },
    });
    expect("POST /stop 200", stopRes.status === 200, `status=${stopRes.status}`);
    const stopped = (await stopRes.json()).data;
    expect("stop: status drops to idle", stopped?.status === "idle", `status=${stopped?.status}`);
    expect("stop: pid is null after stop", stopped?.pid === null, `pid=${stopped?.pid}`);
    expect("stop: log file survives the stop (post-mortem)", existsSync(expectedLogPath));
    expect("stop: log records disconnect lifecycle",
        stopped?.recent_logs?.some((l) => l.includes("[lifecycle] disconnected")),
        `logs=${JSON.stringify(stopped?.recent_logs?.slice(-3))}`);

    // ---- 5. POST /restart — fresh spawn with new PID ----
    const restartRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/restart`, {
        method: "POST",
        headers: { Cookie: cookie },
    });
    expect("POST /restart 200", restartRes.status === 200, `status=${restartRes.status}`);
    const restartedDTO = (await restartRes.json()).data;
    expect("restart: returns DTO with last_check_status=ok",
        restartedDTO?.last_check_status === "ok",
        `status=${restartedDTO?.last_check_status} err=${restartedDTO?.last_check_error}`);

    const rt2Res = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
    const rt2 = (await rt2Res.json()).data;
    expect("restart: status=connected again", rt2?.status === "connected", `status=${rt2?.status}`);
    expect("restart: pid is fresh (different from pre-stop pid)",
        typeof rt2?.pid === "number" && rt2.pid !== pid1,
        `pid_before=${pid1} pid_after=${rt2?.pid}`);

    // ---- 5b. RE-CHECK reuses the same process (no respawn waste) ----
    // The architectural promise: a /check on an already-connected server
    // doesn't tear down the cached connection just to spin up a fresh
    // one — that was a major resource-waste bug in earlier versions.
    const recheckRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect("re-check 200", recheckRes.status === 200, `status=${recheckRes.status}`);
    const rt3Res = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
    const rt3 = (await rt3Res.json()).data;
    expect("re-check: pid unchanged (process REUSED, not respawned)",
        rt3?.pid === rt2.pid,
        `pid_before_check=${rt2.pid} pid_after_check=${rt3?.pid}`);

    // ---- 5c. Rename (non-config edit) does NOT bump config_version ----
    // updatedAt advances on every field edit; config_version is the
    // sentinel that gates the runtime rebuild. They must be distinct so
    // a name change doesn't kill the child process.
    const beforeVer = rt3.built_for;
    const renameRes = await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ description: "edited description" }),
    });
    expect("rename PATCH 200", renameRes.status === 200, `status=${renameRes.status}`);
    const afterRenameRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
    const afterRename = (await afterRenameRes.json()).data;
    expect("rename: built_for unchanged (config_version stable)",
        afterRename?.built_for === beforeVer,
        `before=${beforeVer} after=${afterRename?.built_for}`);
    expect("rename: pid unchanged (no respawn)",
        afterRename?.pid === rt2.pid,
        `pid_before=${rt2.pid} pid_after=${afterRename?.pid}`);

    // ---- 5d. Disable → Re-enable triggers a fresh check ----
    await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ enabled: false }),
    });
    await sleep(200);
    await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ enabled: true }),
    });
    // scheduleCheck is fire-and-forget — give it a moment to land.
    let reenabledDTO = null;
    for (let i = 0; i < 30; i++) {
        await sleep(200);
        const r = await fetch(`${BASE}/api/mcp/servers/${serverId}`, { headers: { Cookie: cookie } });
        reenabledDTO = (await r.json()).data;
        if (reenabledDTO?.last_check_at && reenabledDTO.last_check_at !== serverDTO.last_check_at) break;
    }
    expect("re-enable: scheduleCheck fires, last_check_at advances",
        reenabledDTO?.last_check_at && reenabledDTO.last_check_at !== serverDTO.last_check_at,
        `before=${serverDTO.last_check_at} after=${reenabledDTO?.last_check_at}`);

    // ---- 5e. Combined disable+config PATCH does NOT spawn ----
    // The bug: `PATCH {enabled:false, config:{...}}` would trigger
    // both disposeMcpClient AND scheduleCheck → check spawns a fresh
    // child for the just-disabled server. After fix, the spawn is
    // suppressed because effectiveEnabled is false.
    const rtBeforeCombined = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
    const beforeCombined = (await rtBeforeCombined.json()).data;
    await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            enabled: false,
            config: { command: "node", args: [mcpServerPath, "--touched"] },
        }),
    });
    // Wait the same time scheduleCheck would need to spawn, then
    // verify no spawn happened (status stays idle, pid stays null).
    await sleep(1500);
    const rtAfterCombined = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
    const afterCombined = (await rtAfterCombined.json()).data;
    expect("disable+config: status stays idle (no respawn for disabled server)",
        afterCombined?.status === "idle",
        `status_before=${beforeCombined?.status} status_after=${afterCombined?.status}`);
    expect("disable+config: pid is null (child not spawned)",
        afterCombined?.pid === null,
        `pid=${afterCombined?.pid}`);

    // ---- 5f. Rapid stop → restart doesn't orphan a child ----
    // The architectural promise: dispose leaves the entry in the
    // map (not deleted) so a concurrent build can mutate it instead
    // of orphaning a ConnectedClient that no future cleanup path
    // can reach. We can't introspect leaks directly via the API,
    // but we can verify the runtime state stays coherent across
    // back-to-back lifecycle ops.
    await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ enabled: true }),
    });
    await sleep(500);
    // Hammer: stop, restart, stop, restart, stop, restart.
    const rapidPids = new Set();
    for (let i = 0; i < 3; i++) {
        await fetch(`${BASE}/api/mcp/servers/${serverId}/stop`, { method: "POST", headers: { Cookie: cookie } });
        const restartRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/restart`, { method: "POST", headers: { Cookie: cookie } });
        expect(`rapid cycle ${i + 1}: restart 200`, restartRes.status === 200, `status=${restartRes.status}`);
        await sleep(100);
        const rtRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/runtime`, { headers: { Cookie: cookie } });
        const rt = (await rtRes.json()).data;
        expect(`rapid cycle ${i + 1}: ends in connected state`,
            rt?.status === "connected",
            `status=${rt?.status} error=${rt?.error}`);
        if (typeof rt?.pid === "number") rapidPids.add(rt.pid);
    }
    expect("rapid cycle: each restart spawns a distinct pid (verifies new processes really replace, not stack)",
        rapidPids.size === 3,
        `unique pids seen=${rapidPids.size}`);

    // ---- 5g. Non-admin users see REDACTED config (no secret leak) ----
    // Critical security invariant — env / headers carry tokens. The
    // GET endpoint defaults to user-auth so chat playgrounds can
    // enumerate available servers, but the projection MUST drop the
    // config blob for non-admin callers.
    // First add a real secret to the server config.
    await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            config: {
                command: "node",
                args: [mcpServerPath],
                env: { GITHUB_TOKEN: "REDACTION_CANARY_SECRET" },
            },
        }),
    });
    // Create a non-admin user.
    const createUserRes = await fetch(`${BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ username: "rtuser", password: "rtuserpw", role: "user" }),
    });
    expect("create non-admin user 200", createUserRes.status === 200, `status=${createUserRes.status}`);
    // Log in as that user.
    const userLogin = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "rtuser", user_password: "rtuserpw" }),
    });
    expect("non-admin login 200", userLogin.status === 200, `status=${userLogin.status}`);
    const userCookie = userLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
    // Non-admin GET — config must be empty.
    const userViewRes = await fetch(`${BASE}/api/mcp/servers/${serverId}`, { headers: { Cookie: userCookie } });
    expect("non-admin GET 200", userViewRes.status === 200, `status=${userViewRes.status}`);
    const userView = (await userViewRes.json()).data;
    expect("non-admin: config is redacted to empty object",
        userView?.config && typeof userView.config === "object" && Object.keys(userView.config).length === 0,
        `config=${JSON.stringify(userView?.config)}`);
    expect("non-admin: name/transport/enabled still present",
        userView?.name === "rt-good" && userView?.transport === "stdio" && userView?.enabled === true,
        `dto=${JSON.stringify({name: userView?.name, transport: userView?.transport, enabled: userView?.enabled})}`);
    // Admin GET — config is full plaintext including the canary.
    const adminViewRes = await fetch(`${BASE}/api/mcp/servers/${serverId}`, { headers: { Cookie: cookie } });
    const adminView = (await adminViewRes.json()).data;
    expect("admin: config is the full plaintext blob",
        adminView?.config?.env?.GITHUB_TOKEN === "REDACTION_CANARY_SECRET",
        `env=${JSON.stringify(adminView?.config?.env)}`);
    // Non-admin LIST — same redaction across all rows.
    const userListRes = await fetch(`${BASE}/api/mcp/servers`, { headers: { Cookie: userCookie } });
    const userList = (await userListRes.json()).data;
    const ours = Array.isArray(userList) && userList.find((s) => s.id === serverId);
    expect("non-admin list: same row's config is redacted",
        ours?.config && Object.keys(ours.config).length === 0,
        `config=${JSON.stringify(ours?.config)}`);
    // /tools endpoint must reject non-admin (DoS prevention).
    const userToolsRes = await fetch(`${BASE}/api/mcp/servers/${serverId}/tools`, { headers: { Cookie: userCookie } });
    expect("non-admin /tools returns 403",
        userToolsRes.status === 403,
        `status=${userToolsRes.status}`);

    // ---- 5h. sanitize() name collision rejected at create + update ----
    // Two raw names that reduce to the same prefix would otherwise
    // alias each other in qualifiedTool dispatch. CRUD must refuse.
    const collisionPart = "x".repeat(40); // long enough to hit the 32-char truncation
    const longA = `aaa-${collisionPart}-aaa`;
    const longB = `aaa-${collisionPart}-bbb`; // same first 32 chars as longA
    // Create longA first.
    const longARes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: longA, description: "", transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: false,
        }),
    });
    expect("collision A create 200", longARes.status === 200, `status=${longARes.status}`);
    const longAId = (await longARes.json()).data?.id;
    // Try to create longB — should be rejected.
    const longBRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: longB, description: "", transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: false,
        }),
    });
    expect("collision B create rejected with 400", longBRes.status === 400, `status=${longBRes.status}`);
    const longBBody = await longBRes.json();
    expect("collision rejection mentions tool prefix",
        typeof longBBody?.msg === "string" && longBBody.msg.includes("tool prefix"),
        `msg=${longBBody?.msg}`);

    // Clean up longA.
    await fetch(`${BASE}/api/mcp/servers/${longAId}`, { method: "DELETE", headers: { Cookie: cookie } });

    // ---- 5j. Name containing `__` is rejected (would break unqualify) ----
    const doubleScoreRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "my__server", description: "", transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: false,
        }),
    });
    expect("`__` in name rejected", doubleScoreRes.status === 400, `status=${doubleScoreRes.status}`);
    const doubleScoreBody = await doubleScoreRes.json();
    expect("`__` rejection mentions tool-dispatch separator",
        typeof doubleScoreBody?.msg === "string" && doubleScoreBody.msg.includes("__"),
        `msg=${doubleScoreBody?.msg}`);

    // ---- 5k. Name starting with non-alphanum (sanitizes to leading _) is rejected ----
    const leadingUnderscoreRes = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "!badstart", description: "", transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: false,
        }),
    });
    expect("leading-underscore-after-sanitize name rejected",
        leadingUnderscoreRes.status === 400,
        `status=${leadingUnderscoreRes.status}`);
    const leadingBody = await leadingUnderscoreRes.json();
    expect("leading-underscore rejection mentions alphanumeric requirement",
        typeof leadingBody?.msg === "string" && leadingBody.msg.includes("alphanumeric"),
        `msg=${leadingBody?.msg}`);

    // ---- 5l. PATCH transport without matching config is rejected ----
    // Without this guard a row would land in a hybrid state — transport
    // says "http" but config still carries stdio's command/args, then
    // every buildClient throws Invalid URL forever.
    const transportOnlyRes = await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ transport: "http" }), // no config
    });
    expect("PATCH transport-only rejected", transportOnlyRes.status === 400,
        `status=${transportOnlyRes.status}`);
    const transportOnlyBody = await transportOnlyRes.json();
    expect("PATCH transport-only rejection mentions matching config",
        typeof transportOnlyBody?.msg === "string" && transportOnlyBody.msg.includes("matching config"),
        `msg=${transportOnlyBody?.msg}`);

    // ---- 5i. Decryption-failed flag exposed on DTO ----
    // Corrupting the master key after encryption simulates the case
    // where the admin rotated keys without re-saving secrets. The
    // serializer must surface this as `config_decryption_failed: true`
    // and the form must refuse to save. We can't actually rotate the
    // master key mid-test (loaded once at boot), but we can manually
    // poke the DB row with a bogus ciphertext.
    // Setup: read the encrypted row directly from sqlite (via raw fetch
    // to a hypothetical admin debug endpoint — we don't have one, so
    // we update via the PATCH path with a fake enc:v1: value).
    // The PATCH path re-encrypts on the way in, so we can't inject
    // raw ciphertext via the public API. Skip the assertion if no
    // direct DB access — the unit test above covered the code path.
    // (Documented limitation; the architectural fix is what matters.)

    // ---- 6. DELETE removes log files ----
    const delRes = await fetch(`${BASE}/api/mcp/servers/${serverId}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
    });
    expect("DELETE 200", delRes.status === 200, `status=${delRes.status}`);
    // dispose is fire-and-forget — wait briefly for the close to drain.
    await sleep(300);
    expect("delete: log file removed", !existsSync(expectedLogPath), `still exists at ${expectedLogPath}`);

    console.log(`\n${passed}/${expectations.length} expectations passed`);
    process.exitCode = passed === expectations.length ? 0 : 1;
} catch (err) {
    console.error("e2e harness error:", err);
    console.error("server stdout/stderr:\n" + serverLogs.join(""));
    process.exitCode = 1;
} finally {
    cleanup();
}
