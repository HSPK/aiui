#!/usr/bin/env node
// E2E: verify the gateway records first_token_latency_ms (streaming only)
// and total_latency_ms (always) when forwarding chat completions.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPSTREAM_PORT = 19443;
const SERVER_PORT = 19444;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stub = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "stub-gpt", object: "model" }] }));
        return;
    }
    if (req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", async () => {
            const parsed = JSON.parse(body);
            if (parsed.stream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                await sleep(100);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n`);
                await sleep(50);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`);
                await sleep(50);
                res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`);
                res.write("data: [DONE]\n\n");
                res.end();
            } else {
                await sleep(80);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    choices: [{ message: { role: "assistant", content: "hi" } }],
                    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
                }));
            }
        });
        return;
    }
    res.writeHead(404);
    res.end();
});

const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
const config = `
master_key: ${MASTER_KEY}
admin:
  username: admin
  password: adminpass
providers:
  - name: stub
    type: openai
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/v1
    api_key: sk-test
    enabled: true
`;
writeFileSync(path.join(tmp, ".config", "loom.yaml"), config);

stub.listen(UPSTREAM_PORT);
console.log(`stub upstream on :${UPSTREAM_PORT}`);
console.log(`tmp user cwd: ${tmp}`);

const server = spawn("bun", ["run", "next", "start", "-p", String(SERVER_PORT)], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        LOOM_USER_CWD: tmp,
    },
    stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
const serverLogs = [];
server.stdout.on("data", (d) => {
    const text = d.toString();
    serverLogs.push(text);
    if (text.includes("Ready") || text.includes("Local:")) ready = true;
});
server.stderr.on("data", (d) => serverLogs.push(d.toString()));

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
    stub.close();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
};

try {
    if (!ready) {
        console.log("--- server logs ---\n" + serverLogs.join(""));
        throw new Error("server failed to start");
    }

    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "admin", user_password: "adminpass" }),
    });
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("loom_session="))?.split(";")[0];
    expect("login succeeded", loginRes.ok && !!cookie);

    const streamRes = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ model: "stub-gpt", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect("streaming request returned 200", streamRes.status === 200);
    const reader = streamRes.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    await sleep(500);

    const nsRes = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ model: "stub-gpt", messages: [{ role: "user", content: "hi" }] }),
    });
    expect("non-streaming request returned 200", nsRes.status === 200);
    await nsRes.json();
    await sleep(500);

    const logsRes = await fetch(`${BASE}/api/logs/generations?page=1&page_size=10&sort=-created_at`, {
        headers: { Cookie: cookie },
    });
    const logsJson = await logsRes.json();
    const items = logsJson.data?.items ?? [];
    expect("logs API returned items", items.length >= 2, `got ${items.length}`);

    const ns = items[0];
    const stream = items[1];
    expect(
        "non-streaming log has total_latency_ms",
        typeof ns?.total_latency_ms === "number" && ns.total_latency_ms > 0,
        `total=${ns?.total_latency_ms}`,
    );
    expect(
        "non-streaming log has first_token_latency_ms = null",
        ns?.first_token_latency_ms === null,
        `ttft=${ns?.first_token_latency_ms}`,
    );
    expect(
        "streaming log has total_latency_ms",
        typeof stream?.total_latency_ms === "number" && stream.total_latency_ms > 0,
        `total=${stream?.total_latency_ms}`,
    );
    expect(
        "streaming log has first_token_latency_ms > 0",
        typeof stream?.first_token_latency_ms === "number" && stream.first_token_latency_ms > 0,
        `ttft=${stream?.first_token_latency_ms}`,
    );
    expect(
        "streaming first_token <= total latency",
        stream?.first_token_latency_ms <= stream?.total_latency_ms,
        `ttft=${stream?.first_token_latency_ms} <= total=${stream?.total_latency_ms}`,
    );
} catch (err) {
    console.error("Test threw:", err);
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
