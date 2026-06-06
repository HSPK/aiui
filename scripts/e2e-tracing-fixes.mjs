#!/usr/bin/env node
// E2E: verify gateway tracing fixes
//   - bug-stream-usage: gateway auto-injects stream_options.include_usage=true so usage chunk arrives
//   - bug-raw-output: streaming logs persist a coherent merged OpenAI-style JSON in `generation`/`content`
//   - bug-logs-username: list & detail responses include the actor's username (joined from users table)

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPSTREAM_PORT = 19543;
const SERVER_PORT = 19544;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

// ---- stub upstream that captures the requested body for assertion ----
let lastChatBody = null;

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
            lastChatBody = JSON.parse(body);
            if (lastChatBody.stream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                // Two content chunks
                res.write(`data: ${JSON.stringify({ id: "stub-id-1", model: "stub-gpt", system_fingerprint: "fp_stub", choices: [{ delta: { content: "hello" } }] })}\n\n`);
                await sleep(30);
                res.write(`data: ${JSON.stringify({ id: "stub-id-1", model: "stub-gpt", choices: [{ delta: { content: " world" } }] })}\n\n`);
                await sleep(30);
                // Usage chunk — emitted because client requested include_usage=true
                if (lastChatBody.stream_options?.include_usage) {
                    res.write(`data: ${JSON.stringify({ id: "stub-id-1", usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 } })}\n\n`);
                }
                res.write("data: [DONE]\n\n");
                res.end();
            } else {
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

const tmp = mkdtempSync(path.join(tmpdir(), "aiui-e2e-trace-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
const config = `
master_key: ${MASTER_KEY}
admin:
  username: traceadmin
  password: tracepass
providers:
  - name: stub
    type: openai
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/v1
    api_key: sk-test
    enabled: true
`;
writeFileSync(path.join(tmp, ".config", "aiui.yaml"), config);

stub.listen(UPSTREAM_PORT);
console.log(`stub upstream on :${UPSTREAM_PORT}`);
console.log(`tmp user cwd: ${tmp}`);

const server = spawn("bun", ["run", "next", "start", "-p", String(SERVER_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, AIUI_USER_CWD: tmp },
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
        body: JSON.stringify({ user_name: "traceadmin", user_password: "tracepass" }),
    });
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("aiui_session="))?.split(";")[0];
    expect("login succeeded", loginRes.ok && !!cookie);

    // Trigger a streaming chat — caller does NOT pass stream_options.
    const stream = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "stub-gpt",
            stream: true,
            messages: [{ role: "user", content: "hi" }],
            // No stream_options here on purpose — gateway must inject.
        }),
    });
    expect("streaming request 200", stream.status === 200);
    const reader = stream.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    await sleep(500);

    // ---- bug-stream-usage: gateway injected stream_options.include_usage=true ----
    expect(
        "gateway injected stream_options.include_usage=true",
        lastChatBody?.stream_options?.include_usage === true,
        JSON.stringify(lastChatBody?.stream_options),
    );

    // ---- bug-logs-username + bug-raw-output ----
    const logsRes = await fetch(`${BASE}/api/logs/generations?page=1&page_size=5&sort=-created_at`, {
        headers: { Cookie: cookie },
    });
    const logsJson = await logsRes.json();
    const item = logsJson.data?.items?.[0];
    expect("logs list returned item", !!item);
    expect("logs list item has username=traceadmin (bug-logs-username)", item?.username === "traceadmin", `username=${item?.username}`);
    expect("logs list item still has user_id", typeof item?.user_id === "string" && item.user_id.length > 0);
    expect("logs list item has prompt_tokens (bug-stream-usage payoff)", item?.prompt_tokens === 7, `prompt_tokens=${item?.prompt_tokens}`);
    expect("logs list item has completion_tokens", item?.completion_tokens === 4);
    expect("logs list item has total_tokens", item?.total_tokens === 11);

    const detailRes = await fetch(`${BASE}/api/logs/generations/${item.id}`, { headers: { Cookie: cookie } });
    const detailJson = await detailRes.json();
    const detail = detailJson.data;
    expect("log detail returned", !!detail);
    expect("log detail.username = traceadmin", detail?.username === "traceadmin");

    // ---- bug-raw-output: streaming generation is a coherent OpenAI-shape merged JSON ----
    expect("generation has choices[]", Array.isArray(detail?.generation?.choices));
    expect("generation.choices[0].message.content concatenates the stream", detail?.generation?.choices?.[0]?.message?.content === "hello world", `got "${detail?.generation?.choices?.[0]?.message?.content}"`);
    expect("generation carries upstream id", detail?.generation?.id === "stub-id-1");
    expect("generation carries upstream model", detail?.generation?.model === "stub-gpt");
    expect("generation carries system_fingerprint", detail?.generation?.system_fingerprint === "fp_stub");
    expect("generation.usage present", detail?.generation?.usage?.total_tokens === 11);
} catch (err) {
    console.error("Test threw:", err);
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
