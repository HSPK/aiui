#!/usr/bin/env node
// E2E: verify the responses API variant
//   1. Discovery surfaces capabilities.responses → supported_apis includes "responses"
//   2. Gateway picks the responses variant for chat-capability requests
//   3. Request body is translated: messages → input, system → instructions,
//      max_tokens → max_output_tokens, stream_options dropped
//   4. URL is /responses (not /chat/completions)
//   5. Non-stream: response is chat-completion-shaped (transcoded from responses)
//   6. Stream: SSE events are chat-completion chunks (transcoded from response.* events)
//   7. Reasoning deltas flow through

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPSTREAM_PORT = 19551;
const SERVER_PORT = 19552;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

// ---- stub upstream that captures the request body + URL ----
let lastRequest = null;

const stub = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        // openai adapter's id-based classifier picks "chat" for "gpt-".
        // We need supported_apis = ["responses"] which means we ship a
        // raw entry with `capabilities.responses = "true"` — but the
        // openai adapter's extractModelMeta doesn't read that. So we
        // route this provider through `azure-foundry` adapter which DOES
        // honour the capabilities block.
        res.end(JSON.stringify({
            object: "list",
            data: [
                {
                    id: "gpt-resp",
                    object: "model",
                    model: { Publisher: "Test", Format: "OpenAI", Name: "gpt-resp", Version: "1" },
                    capabilities: { chatCompletion: "true", responses: "true" },
                    RateLimits: { requests: 100, tokens: 100000 },
                    owned_by: "stub",
                },
            ],
        }));
        return;
    }

    if (req.url === "/v1/chat/completions") {
        // Should not be hit when responses variant is selected.
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
            lastRequest = { url: req.url, body: JSON.parse(body) };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                choices: [{ message: { role: "assistant", content: "wrong path" } }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            }));
        });
        return;
    }

    if (req.url === "/v1/responses") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", async () => {
            lastRequest = { url: req.url, body: JSON.parse(body) };
            const isStream = !!lastRequest.body.stream;
            if (isStream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                res.write(`event: response.created\n`);
                res.write(`data: ${JSON.stringify({
                    type: "response.created",
                    response: { id: "resp_stub_1", model: lastRequest.body.model, status: "in_progress" },
                })}\n\n`);
                await sleep(20);
                res.write(`event: response.output_text.delta\n`);
                res.write(`data: ${JSON.stringify({
                    type: "response.output_text.delta",
                    delta: "hello",
                })}\n\n`);
                await sleep(20);
                res.write(`event: response.output_text.delta\n`);
                res.write(`data: ${JSON.stringify({
                    type: "response.output_text.delta",
                    delta: " responses",
                })}\n\n`);
                await sleep(20);
                res.write(`event: response.reasoning_summary_text.delta\n`);
                res.write(`data: ${JSON.stringify({
                    type: "response.reasoning_summary_text.delta",
                    delta: "thinking...",
                })}\n\n`);
                await sleep(20);
                res.write(`event: response.completed\n`);
                res.write(`data: ${JSON.stringify({
                    type: "response.completed",
                    response: {
                        id: "resp_stub_1",
                        model: lastRequest.body.model,
                        status: "completed",
                        usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
                    },
                })}\n\n`);
                res.end();
                return;
            }
            // Non-stream
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                id: "resp_stub_1",
                object: "response",
                created_at: Math.floor(Date.now() / 1000),
                model: lastRequest.body.model,
                status: "completed",
                output: [
                    {
                        type: "message",
                        role: "assistant",
                        content: [{ type: "output_text", text: "hello from responses" }],
                    },
                ],
                usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
            }));
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

// ---- bootstrap ----
const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-resp-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
const config = `
master_key: ${MASTER_KEY}
admin:
  username: respadmin
  password: resppass
providers:
  - name: respstub
    # azure-foundry adapter honours the capabilities block, which is how
    # we get supported_apis = ["responses"] from the stub's /v1/models.
    adapter_id: azure-foundry
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
    env: { ...process.env, LOOM_USER_CWD: tmp },
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
    expect("server is up", ready);

    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "respadmin", user_password: "resppass" }),
    });
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("loom_session="))?.split(";")[0];
    expect("login succeeded", loginRes.ok && !!cookie);

    // -------------------------------------------------------------------
    // Discovery — model surfaces with supported_apis including "responses"
    // -------------------------------------------------------------------
    const modelsRes = await fetch(`${BASE}/api/models`, { headers: { Cookie: cookie } });
    const modelsJson = await modelsRes.json();
    const respModel = (modelsJson.data ?? []).find((m) => m.name === "gpt-resp");
    expect("responses-capable model is discovered", !!respModel);
    expect(
        "model meta.supported_apis includes 'responses'",
        respModel?.meta?.supported_apis?.includes("responses"),
        JSON.stringify(respModel?.meta?.supported_apis),
    );

    // -------------------------------------------------------------------
    // Non-stream chat — gateway must pick responses variant
    // -------------------------------------------------------------------
    lastRequest = null;
    const nsReq = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "gpt-resp",
            messages: [
                { role: "system", content: "Be brief." },
                { role: "user", content: "hi" },
            ],
            max_tokens: 64,
        }),
    });
    expect("non-stream request 200", nsReq.status === 200, `status=${nsReq.status}`);

    expect(
        "upstream URL was /responses (not /chat/completions)",
        lastRequest?.url === "/v1/responses",
        `url=${lastRequest?.url}`,
    );
    expect(
        "request body shape: `input` array (not `messages`)",
        Array.isArray(lastRequest?.body?.input) && !lastRequest.body.messages,
        `keys=${Object.keys(lastRequest?.body ?? {})}`,
    );
    expect(
        "system message extracted to `instructions`",
        lastRequest?.body?.instructions === "Be brief.",
        `instructions=${lastRequest?.body?.instructions}`,
    );
    expect(
        "max_tokens renamed to max_output_tokens",
        lastRequest?.body?.max_output_tokens === 64 && lastRequest?.body?.max_tokens === undefined,
        `max_output_tokens=${lastRequest?.body?.max_output_tokens}`,
    );
    expect(
        "first input item is the user message",
        lastRequest?.body?.input?.[0]?.role === "user" &&
            lastRequest?.body?.input?.[0]?.content?.[0]?.text === "hi",
        JSON.stringify(lastRequest?.body?.input?.[0]),
    );
    expect(
        "user content uses input_text type",
        lastRequest?.body?.input?.[0]?.content?.[0]?.type === "input_text",
        JSON.stringify(lastRequest?.body?.input?.[0]?.content),
    );

    const nsJson = await nsReq.json();
    expect(
        "client got chat-completion shape: object=chat.completion",
        nsJson?.object === "chat.completion",
        `object=${nsJson?.object}`,
    );
    expect(
        "transcoded content reaches client",
        nsJson?.choices?.[0]?.message?.content === "hello from responses",
        `content=${nsJson?.choices?.[0]?.message?.content}`,
    );
    expect(
        "usage normalized: prompt_tokens=8 (was input_tokens)",
        nsJson?.usage?.prompt_tokens === 8,
        `prompt_tokens=${nsJson?.usage?.prompt_tokens}`,
    );
    expect(
        "usage normalized: completion_tokens=4 (was output_tokens)",
        nsJson?.usage?.completion_tokens === 4,
        `completion_tokens=${nsJson?.usage?.completion_tokens}`,
    );
    expect(
        "usage normalized: total_tokens=12",
        nsJson?.usage?.total_tokens === 12,
        `total_tokens=${nsJson?.usage?.total_tokens}`,
    );

    // -------------------------------------------------------------------
    // Stream chat — gateway transcodes responses.* events → chat.completion.chunk
    // -------------------------------------------------------------------
    lastRequest = null;
    const sReq = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "gpt-resp",
            stream: true,
            messages: [{ role: "user", content: "stream please" }],
        }),
    });
    expect("stream request 200", sReq.status === 200);
    expect("stream upstream URL was /responses", lastRequest?.url === "/v1/responses");

    const body = await sReq.text();
    const events = body
        .split("\n\n")
        .map((b) => b.trim())
        .filter((b) => b.startsWith("data:"))
        .map((b) => b.slice(5).trim())
        .filter((d) => d && d !== "[DONE]")
        .map((d) => {
            try { return JSON.parse(d); } catch { return null; }
        })
        .filter(Boolean);

    expect("client received at least one SSE chunk", events.length > 0, `count=${events.length}`);
    expect(
        "all chunks have object=chat.completion.chunk (transcoded)",
        events.every((e) => e.object === "chat.completion.chunk"),
        events.map((e) => e.object).join(","),
    );

    // Accumulate content from the deltas the client sees.
    const accumContent = events
        .map((e) => e?.choices?.[0]?.delta?.content ?? "")
        .filter(Boolean)
        .join("");
    expect(
        "accumulated content from stream = 'hello responses'",
        accumContent === "hello responses",
        `got "${accumContent}"`,
    );

    const accumReasoning = events
        .map((e) => e?.choices?.[0]?.delta?.reasoning_content ?? "")
        .filter(Boolean)
        .join("");
    expect(
        "reasoning_summary_text.delta transcoded to reasoning_content delta",
        accumReasoning === "thinking...",
        `got "${accumReasoning}"`,
    );

    // Final chunk should carry finish_reason=stop and usage in canonical shape.
    const terminal = events[events.length - 1];
    expect(
        "terminal chunk has finish_reason=stop",
        terminal?.choices?.[0]?.finish_reason === "stop",
        JSON.stringify(terminal?.choices?.[0]),
    );
    expect(
        "terminal chunk has chat-shape usage (prompt_tokens=12)",
        terminal?.usage?.prompt_tokens === 12 &&
            terminal?.usage?.completion_tokens === 5 &&
            terminal?.usage?.total_tokens === 17,
        JSON.stringify(terminal?.usage),
    );

    // -------------------------------------------------------------------
    // Log: persisted shape is chat-completion (not responses raw)
    // -------------------------------------------------------------------
    await sleep(300);
    const logsRes = await fetch(`${BASE}/api/logs/generations?page=1&page_size=5&sort=-created_at`, {
        headers: { Cookie: cookie },
    });
    const logsJson = await logsRes.json();
    const recentLog = logsJson.data?.items?.[0];
    expect("log captured for streaming request", !!recentLog);
    expect("log has total_tokens=17 (from terminal chunk)", recentLog?.total_tokens === 17);

    const detailRes = await fetch(`${BASE}/api/logs/generations/${recentLog.id}`, {
        headers: { Cookie: cookie },
    });
    const detail = (await detailRes.json()).data;
    expect(
        "persisted log content is chat-completion shaped",
        detail?.content?.object === "chat.completion",
        `object=${detail?.content?.object}`,
    );
    expect(
        "log content has accumulated chat message text",
        detail?.content?.choices?.[0]?.message?.content === "hello responses",
        detail?.content?.choices?.[0]?.message?.content,
    );

    // -------------------------------------------------------------------
    // model.api_variant_id pin: create an override that forces this model
    // to use chat.completions even though the model declares responses
    // support (and the capability prefers responses). The pin must win.
    // -------------------------------------------------------------------
    const providersListRes = await fetch(`${BASE}/api/providers`, { headers: { Cookie: cookie } });
    const respProvider = (await providersListRes.json()).data?.find((p) => p.name === "respstub");
    expect("provider listed for override creation", !!respProvider);

    const createRes = await fetch(`${BASE}/api/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "gpt-resp-pinned",
            provider_id: respProvider.id,
            upstream_model_id: "gpt-resp",
            type: "chat",
            api_variant_id: "chat.completions",
        }),
    });
    const created = (await createRes.json()).data;
    expect(
        "override created with api_variant_id=chat.completions",
        createRes.status === 200 && created?.api_variant_id === "chat.completions",
        `api_variant_id=${created?.api_variant_id}`,
    );

    // Hit the gateway under the pinned override — should land on
    // /chat/completions instead of /responses.
    lastRequest = null;
    const pinnedReq = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "gpt-resp-pinned",
            messages: [{ role: "user", content: "hi" }],
        }),
    });
    expect("pinned request 200", pinnedReq.status === 200);
    expect(
        "pinned model routed to /chat/completions (override wins over capability preference)",
        lastRequest?.url === "/v1/chat/completions",
        `url=${lastRequest?.url}`,
    );

    // Update the pin to null and verify the auto-preference kicks back in.
    const updateRes = await fetch(`${BASE}/api/models/${encodeURIComponent(created.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ api_variant_id: null }),
    });
    const updated = (await updateRes.json()).data;
    expect(
        "PATCH cleared api_variant_id",
        updateRes.status === 200 && updated?.api_variant_id === null,
        `api_variant_id=${updated?.api_variant_id}`,
    );

    lastRequest = null;
    const autoReq = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "gpt-resp-pinned",
            messages: [{ role: "user", content: "hi" }],
        }),
    });
    expect("auto request 200", autoReq.status === 200);
    expect(
        "with pin cleared, auto-preference picks /responses again",
        lastRequest?.url === "/v1/responses",
        `url=${lastRequest?.url}`,
    );

} catch (err) {
    console.error("Test threw:", err);
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
