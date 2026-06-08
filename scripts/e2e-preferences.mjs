#!/usr/bin/env node
// E2E: round-trip /api/users/me/preferences
// - GET on a brand-new user returns server defaults
// - PATCH merges (partial updates preserve other fields)
// - GET reflects what PATCH wrote, cross-process

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const SERVER_PORT = 19445;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

// ---- temp config ----
const tmp = mkdtempSync(path.join(tmpdir(), "aiui-e2e-prefs-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
const config = `
master_key: ${MASTER_KEY}
admin:
  username: admin
  password: adminpass
`;
writeFileSync(path.join(tmp, ".config", "aiui.yaml"), config);

// ---- spawn server ----
const server = spawn("bun", ["run", "next", "start", "-p", String(SERVER_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, AIUI_USER_CWD: tmp },
    stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
const logs = [];
server.stdout.on("data", (d) => {
    const t = d.toString();
    logs.push(t);
    if (t.includes("Ready") || t.includes("Local:")) ready = true;
});
server.stderr.on("data", (d) => logs.push(d.toString()));

for (let i = 0; i < 60; i++) {
    if (ready) break;
    try {
        const r = await fetch(`${BASE}/api/ping`);
        if (r.ok) { ready = true; break; }
    } catch {}
    await sleep(500);
}
expect("server is up", ready);

const cleanup = () => {
    server.kill();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
};

try {
    if (!ready) {
        console.error("server failed to start\n" + logs.join(""));
        throw new Error("no server");
    }

    // login
    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "admin", user_password: "adminpass" }),
    });
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("aiui_session="))?.split(";")[0];
    expect("login succeeded", loginRes.ok && !!cookie);

    // GET — should return defaults for a brand-new user
    const get1 = await fetch(`${BASE}/api/users/me/preferences`, { headers: { Cookie: cookie } });
    const got1 = await get1.json();
    expect("GET ok (defaults)", get1.ok && got1.code === 0);
    expect("default_model is empty string", got1.data.default_model === "");
    expect("user_name default = 'User'", got1.data.user_name === "User");
    expect("default_history_limit default = 10", got1.data.default_history_limit === 10);

    // PATCH — partial update
    const patchBody = { default_model: "gpt-4o-mini", user_name: "Hang", default_history_limit: 25 };
    const patchRes = await fetch(`${BASE}/api/users/me/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(patchBody),
    });
    const patched = await patchRes.json();
    expect("PATCH ok", patchRes.ok && patched.code === 0);
    expect("PATCH applied default_model", patched.data.default_model === "gpt-4o-mini");
    expect("PATCH preserved untouched user_avatar", patched.data.user_avatar === "👤");
    expect("PATCH applied default_history_limit", patched.data.default_history_limit === 25);

    // GET again — verify persistence
    const get2 = await fetch(`${BASE}/api/users/me/preferences`, { headers: { Cookie: cookie } });
    const got2 = await get2.json();
    expect("GET reflects PATCH (default_model)", got2.data.default_model === "gpt-4o-mini");
    expect("GET reflects PATCH (user_name)", got2.data.user_name === "Hang");
    expect("GET reflects PATCH (default_history_limit)", got2.data.default_history_limit === 25);

    // Validation: PATCH with bad type should 400
    const bad = await fetch(`${BASE}/api/users/me/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ default_history_limit: "not a number" }),
    });
    expect("PATCH rejects invalid type", bad.status === 400);
} catch (err) {
    console.error("Test threw:", err);
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
