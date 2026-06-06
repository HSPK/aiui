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
    const isFoundryUrl = req.url.startsWith("/foundry/");
    // Proxied-Foundry-as-OpenAI: looks like /v1/... at the URL layer
    // (so transport adapter auto-detects as "openai"), but the upstream
    // rejects stream_options just like a strict Foundry endpoint would.
    // Used to assert both provider-level and model-level schema_adapter_id
    // overrides correctly steer the gateway.
    const isProxyFoundryUrl = req.url.startsWith("/proxy-foundry/");
    const isProxyFoundryPLUrl = req.url.startsWith("/proxy-foundry-pl/");
    if (req.url === "/health-ok") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
    }
    if (req.url === "/health-bad") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "degraded" }));
        return;
    }
    if (req.url === "/v1/models" || req.url === "/foundry/v1/models" || req.url === "/proxy-foundry/v1/models" || req.url === "/proxy-foundry-pl/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        // Distinct model ids per endpoint so discovery routes the request
        // through the intended provider + adapter.
        if (isFoundryUrl) {
            // Realistic Foundry shape: nested model.* block, capabilities,
            // RateLimits — exercises azure-foundry adapter's extractModelMeta.
            res.end(JSON.stringify({
                object: "list",
                data: [{
                    id: "gcr-fara-7b",
                    object: "model",
                    model: { Publisher: "xAI", Format: "xAI", Name: "fara-7b", Version: "1" },
                    capabilities: { chatCompletion: "true", batch: "true" },
                    RateLimits: { requests: 850, tokens: 850000 },
                    owned_by: "gcraifoundrysw",
                }],
            }));
        } else if (isProxyFoundryUrl) {
            // Proxy emits standard OpenAI shape — no rich metadata.
            res.end(JSON.stringify({ object: "list", data: [{ id: "proxied-fara", object: "model" }] }));
        } else if (isProxyFoundryPLUrl) {
            // Provider-level override version: also bare OpenAI shape.
            res.end(JSON.stringify({ object: "list", data: [{ id: "proxied-fara-pl", object: "model" }] }));
        } else {
            // Stub returns a chat model AND an embedding model — exercises
            // the openai adapter's id-based capability classifier.
            res.end(JSON.stringify({
                object: "list",
                data: [
                    { id: "stub-gpt", object: "model" },
                    { id: "text-embedding-3-small", object: "model" },
                ],
            }));
        }
        return;
    }
    if (req.url === "/v1/chat/completions" || req.url === "/foundry/v1/chat/completions" || req.url === "/proxy-foundry/v1/chat/completions" || req.url === "/proxy-foundry-pl/v1/chat/completions") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", async () => {
            lastChatBody = JSON.parse(body);
            // Simulate Azure Foundry's strict `extra-parameters: error` policy
            // by rejecting requests that include stream_options. Same policy
            // applied at all /proxy-foundry*/ paths to assert the schema-
            // adapter override strips the field at whichever level it's set.
            if ((isFoundryUrl || isProxyFoundryUrl || isProxyFoundryPLUrl) && lastChatBody.stream_options !== undefined) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    detail: "Extra parameters ['stream_options'] are not allowed when extra-parameters is not set or set to be 'error'. Set extra-parameters to 'pass-through' to pass to the model.",
                }));
                return;
            }
            if (lastChatBody.stream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                res.write(`data: ${JSON.stringify({ id: "stub-id-1", model: lastChatBody.model, system_fingerprint: "fp_stub", choices: [{ delta: { content: "hello" } }] })}\n\n`);
                await sleep(30);
                res.write(`data: ${JSON.stringify({ id: "stub-id-1", model: lastChatBody.model, choices: [{ delta: { content: " world" } }] })}\n\n`);
                await sleep(30);
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
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/v1
    api_key: sk-test
    health_check_url: http://127.0.0.1:${UPSTREAM_PORT}/health-ok
    enabled: true
  - name: foundry
    adapter_id: azure-foundry
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/foundry/v1
    api_key: sk-test
    enabled: true
  - name: proxy-foundry
    # Proxy is OpenAI-shaped at the URL layer but the upstream rejects
    # OpenAI-only fields. Setting adapter_id explicitly lets the gateway
    # apply Foundry's strict filtering despite the openai URL pattern.
    adapter_id: azure-foundry
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/proxy-foundry/v1
    api_key: sk-test
    health_check_url: http://127.0.0.1:${UPSTREAM_PORT}/health-bad
    enabled: true
  - name: optout
    # Health-bad provider, openai transport, but we disable stream_options
    # injection at the default_params layer — no adapter trickery needed.
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/proxy-foundry-pl/v1
    api_key: sk-test
    default_params:
      stream_options: null
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

    // -------------------------------------------------------------------
    // bug-stream-opts-optout: when provider default_params.stream_options
    // is null, the gateway must strip the field instead of injecting it
    // — Azure Foundry / strict endpoints (here simulated by /foundry/...)
    // would otherwise reject the request with HTTP 400.
    // -------------------------------------------------------------------
    lastChatBody = null;
    const foundryStream = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "gcr-fara-7b",
            stream: true,
            messages: [{ role: "user", content: "hi" }],
        }),
    });
    expect("foundry streaming request 200 (would 400 without opt-out)", foundryStream.status === 200, `status=${foundryStream.status}`);
    if (foundryStream.body) {
        const fReader = foundryStream.body.getReader();
        while (true) { const { done } = await fReader.read(); if (done) break; }
    }
    await sleep(300);
    expect(
        "gateway stripped stream_options for foundry provider",
        lastChatBody?.stream_options === undefined,
        `stream_options=${JSON.stringify(lastChatBody?.stream_options)}`,
    );

    // -------------------------------------------------------------------
    // adapter registry: /api/adapters lists the registered adapters and
    // includes our three OpenAI-family ones.
    // -------------------------------------------------------------------
    const adaptersRes = await fetch(`${BASE}/api/adapters`, { headers: { Cookie: cookie } });
    const adaptersJson = await adaptersRes.json();
    const adapterIds = (adaptersJson.data ?? []).map((a) => a.id);
    expect("/api/adapters returns openai", adapterIds.includes("openai"));
    expect("/api/adapters returns azure-openai", adapterIds.includes("azure-openai"));
    expect("/api/adapters returns azure-foundry", adapterIds.includes("azure-foundry"));

    // -------------------------------------------------------------------
    // Adapter-projected metadata surfaces in /api/models for the
    // discovered Foundry model — proves discoveredMetadata + extractModelMeta
    // round-trip and the FE can render the rich Foundry RateLimits etc.
    // -------------------------------------------------------------------
    const modelsRes = await fetch(`${BASE}/api/models`, { headers: { Cookie: cookie } });
    const modelsJson = await modelsRes.json();
    const foundryModel = (modelsJson.data ?? []).find((m) => m.name === "gcr-fara-7b");
    expect("Foundry model is listed", !!foundryModel);
    expect("Foundry model has meta with rate_limits.requests=850", foundryModel?.meta?.rate_limits?.requests === 850);
    expect("Foundry model meta publisher=xAI", foundryModel?.meta?.publisher === "xAI");
    expect("Foundry model meta rejects stream_options", foundryModel?.meta?.rejected_fields?.includes("stream_options") === true);
    expect("Foundry model meta supports chat.completions", foundryModel?.meta?.supported_apis?.includes("chat.completions") === true);

    // openai adapter's extractModelMeta must classify by id, not collapse
    // every entry to chat.
    const embedModel = (modelsJson.data ?? []).find((m) => m.name === "text-embedding-3-small");
    expect("openai discovery surfaces non-chat models", !!embedModel);
    expect(
        "openai adapter classifies text-embedding-3-small as embedding (id-based)",
        embedModel?.type === "embedding",
        `type=${embedModel?.type}`,
    );
    const chatModel = (modelsJson.data ?? []).find((m) => m.name === "stub-gpt");
    expect("openai adapter still classifies gpt-* as chat", chatModel?.type === "chat", `type=${chatModel?.type}`);

    // -------------------------------------------------------------------
    // Health-check persistence: providers with health_check_url should
    // (a) start with last_health_status === null (never probed), then
    // (b) POST /providers/:id/check writes "ok" / "down" to last_health_*,
    // (c) the DTO surfaces those fields for the FE pill.
    // The "stub" provider's health URL returns {status:"ok"}; the
    // "proxy-foundry" provider's returns {status:"degraded"} (should be down).
    // -------------------------------------------------------------------
    const providersBeforeRes = await fetch(`${BASE}/api/providers`, { headers: { Cookie: cookie } });
    const providersBefore = (await providersBeforeRes.json()).data ?? [];
    const stubProvider = providersBefore.find((p) => p.name === "stub");
    const proxyProvider = providersBefore.find((p) => p.name === "proxy-foundry");
    expect(
        "providers DTO has health fields",
        stubProvider && "last_health_status" in stubProvider && "last_health_checked_at" in stubProvider && "last_health_error" in stubProvider,
    );
    expect("stub provider has no health status before probing", stubProvider?.last_health_status === null);
    expect("stub provider exposes its health_check_url", stubProvider?.health_check_url?.endsWith("/health-ok") === true);

    // Probe both providers' health endpoints.
    const okProbe = await fetch(`${BASE}/api/providers/${encodeURIComponent(stubProvider.id)}/check`, {
        method: "POST", headers: { Cookie: cookie },
    });
    const okProbeJson = (await okProbe.json()).data;
    expect("stub provider health check returns ok=true", okProbeJson?.ok === true);

    const downProbe = await fetch(`${BASE}/api/providers/${encodeURIComponent(proxyProvider.id)}/check`, {
        method: "POST", headers: { Cookie: cookie },
    });
    const downProbeJson = (await downProbe.json()).data;
    expect("proxy-foundry health check returns ok=false", downProbeJson?.ok === false);
    expect("proxy-foundry health check carries error message", typeof downProbeJson?.error === "string" && downProbeJson.error.length > 0);

    const providersAfterRes = await fetch(`${BASE}/api/providers`, { headers: { Cookie: cookie } });
    const providersAfter = (await providersAfterRes.json()).data ?? [];
    const stubAfter = providersAfter.find((p) => p.name === "stub");
    const proxyAfter = providersAfter.find((p) => p.name === "proxy-foundry");
    expect("stub provider persists last_health_status='ok'", stubAfter?.last_health_status === "ok");
    expect("stub provider has last_health_checked_at set", typeof stubAfter?.last_health_checked_at === "string");
    expect("stub provider has no error after ok probe", stubAfter?.last_health_error === null);
    expect("proxy-foundry persists last_health_status='down'", proxyAfter?.last_health_status === "down");
    expect("proxy-foundry persists last_health_error", typeof proxyAfter?.last_health_error === "string" && proxyAfter.last_health_error.length > 0);

    // -------------------------------------------------------------------
    // Explicit adapter_id covers the proxy case: provider URL looks like
    // /v1/... (OpenAI-shaped) but the upstream actually rejects
    // OpenAI-only fields. Setting `adapter_id: azure-foundry` in YAML
    // tells the gateway to apply Foundry's strict filtering anyway.
    // Streaming a discovered model must succeed (no per-model config).
    // -------------------------------------------------------------------
    const proxyProviderAfter = providersAfter.find((p) => p.name === "proxy-foundry");
    expect("proxy-foundry adapter_id was honored from YAML", proxyProviderAfter?.adapter_id === "azure-foundry");

    lastChatBody = null;
    const proxyStream = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "proxied-fara",  // discovered under proxy-foundry
            stream: true,
            messages: [{ role: "user", content: "hi" }],
        }),
    });
    expect(
        "explicit adapter_id=azure-foundry on openai-shaped URL streams 200",
        proxyStream.status === 200,
        `status=${proxyStream.status}`,
    );
    if (proxyStream.body) {
        const r = proxyStream.body.getReader();
        while (true) { const { done } = await r.read(); if (done) break; }
    }
    await sleep(300);
    expect(
        "Foundry filtering applied via explicit adapter_id — stream_options stripped",
        lastChatBody?.stream_options === undefined,
        `stream_options=${JSON.stringify(lastChatBody?.stream_options)}`,
    );

    // -------------------------------------------------------------------
    // Default-params escape hatch: provider sets `default_params.stream_options: null`
    // → mergeParams puts null into the body → maybeInjectStreamUsage sees
    // null and DROPS the field. No backend adapter magic needed.
    // -------------------------------------------------------------------
    const optoutProvider = providersAfter.find((p) => p.name === "optout");
    expect("optout provider exists", !!optoutProvider);
    expect(
        "optout provider preserves default_params.stream_options=null from YAML",
        // YAML's `null` becomes JSON null in the DTO
        Object.prototype.hasOwnProperty.call(optoutProvider?.default_params ?? {}, "stream_options")
            && optoutProvider?.default_params?.stream_options === null,
        `default_params=${JSON.stringify(optoutProvider?.default_params)}`,
    );

    lastChatBody = null;
    const optoutStream = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "proxied-fara-pl",
            stream: true,
            messages: [{ role: "user", content: "hi" }],
        }),
    });
    expect(
        "default_params escape: stream succeeded (would 400 with stream_options)",
        optoutStream.status === 200,
        `status=${optoutStream.status}`,
    );
    if (optoutStream.body) {
        const r = optoutStream.body.getReader();
        while (true) { const { done } = await r.read(); if (done) break; }
    }
    await sleep(300);
    expect(
        "default_params.stream_options=null drops the field entirely",
        lastChatBody?.stream_options === undefined,
        `stream_options=${JSON.stringify(lastChatBody?.stream_options)}`,
    );
} catch (err) {
    console.error("Test threw:", err);
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
