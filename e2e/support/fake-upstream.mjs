// Minimal OpenAI-compatible upstream used by the E2E suite.
//
// Lets the browser tests drive the whole streaming pipeline — gateway →
// variant transcode → SSE → stream-parser → React render — without a real
// provider, an API key, or network flakiness. Token cadence is controllable
// so the INP benchmark can produce a realistic, repeatable token storm.

import { createServer } from "node:http";

const MODELS = [
    { id: "e2e-chat", object: "model", owned_by: "loom-e2e" },
    { id: "e2e-chat-fast", object: "model", owned_by: "loom-e2e" },
    { id: "e2e-embedding", object: "model", owned_by: "loom-e2e" },
];

const LOREM =
    "Streaming responsiveness is measured by how quickly the interface reacts " +
    "to input while tokens are still arriving. This sentence exists purely to " +
    "generate a realistic number of chunks so the benchmark has something to " +
    "chew on. ";

function tokens(count) {
    const words = LOREM.split(" ");
    const out = [];
    for (let i = 0; i < count; i++) out.push(words[i % words.length] + " ");
    return out;
}

function sseChunk(delta, extra = {}) {
    return `data: ${JSON.stringify({
        id: "chatcmpl-e2e",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "e2e-chat",
        choices: [{ index: 0, delta, finish_reason: null }],
        ...extra,
    })}\n\n`;
}

function readBody(req) {
    return new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => { raw += c; });
        req.on("end", () => {
            try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
        });
    });
}

// `fail=once` bookkeeping: fail the first request for a given prompt, then
// succeed on every identical retry. Lives for the lifetime of this process
// (one throwaway server per Playwright run), keyed on the exact prompt text
// so parallel specs using distinct wording never collide.
const failOnceSeen = new Set();

/** Backwards-compatible test hook (opt-in via prompt substring; existing
 *  prompts never contain these tokens, so default behaviour is unchanged):
 *    `fail=1`    — every request for this prompt gets a soft failure.
 *    `fail=once` — only the FIRST request for this exact prompt fails; a
 *                  retry with the identical prompt succeeds normally. Lets
 *                  specs assert the retry affordance actually recovers.
 *  Both emit the shape Loom's gateway explicitly special-cases: an upstream
 *  HTTP 200 whose body is `{error:{message}}` with no `choices`, handled by
 *  `extractUpstreamError` (lib/server/api-variants/index.ts:134) and used by
 *  every variant's `parseResponse`/`parseStreamChunk` (e.g.
 *  lib/server/api-variants/chat-completions.ts) — the same "soft failure"
 *  pattern vLLM / LM Studio / LocalAI emit in the wild. */
function shouldSimulateFailure(prompt) {
    if (/\bfail=once\b/.test(prompt)) {
        const first = !failOnceSeen.has(prompt);
        failOnceSeen.add(prompt);
        return first;
    }
    return /\bfail=1\b/.test(prompt);
}

const FAILURE_MESSAGE = "Simulated upstream failure (e2e fail hook)";

const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: MODELS }));
        return;
    }

    if (url.pathname.endsWith("/embeddings")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: Array.from({ length: 8 }, (_, i) => i / 8) }],
            model: "e2e-embedding",
            usage: { prompt_tokens: 4, total_tokens: 4 },
        }));
        return;
    }

    if (url.pathname.endsWith("/chat/completions")) {
        const body = await readBody(req);
        // Test hooks, passed through from the prompt so a spec can ask for a
        // specific shape without extra endpoints.
        const prompt = JSON.stringify(body.messages ?? "");
        const count = Number(/tokens=(\d+)/.exec(prompt)?.[1] ?? 60);
        const delayMs = Number(/delay=(\d+)/.exec(prompt)?.[1] ?? 8);

        if (shouldSimulateFailure(prompt)) {
            const errorBody = { error: { message: FAILURE_MESSAGE } };
            if (!body.stream) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(errorBody));
                return;
            }
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });
            res.write(`data: ${JSON.stringify(errorBody)}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
        }

        if (!body.stream) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                id: "chatcmpl-e2e",
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? "e2e-chat",
                choices: [{ index: 0, message: { role: "assistant", content: tokens(count).join("") }, finish_reason: "stop" }],
                usage: { prompt_tokens: 10, completion_tokens: count, total_tokens: 10 + count },
            }));
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.write(sseChunk({ role: "assistant", content: "" }));
        const parts = tokens(count);
        let i = 0;
        const tick = setInterval(() => {
            if (i >= parts.length) {
                clearInterval(tick);
                res.write(`data: ${JSON.stringify({
                    id: "chatcmpl-e2e", object: "chat.completion.chunk", model: "e2e-chat",
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    usage: { prompt_tokens: 10, completion_tokens: parts.length, total_tokens: 10 + parts.length },
                })}\n\n`);
                res.write("data: [DONE]\n\n");
                res.end();
                return;
            }
            res.write(sseChunk({ content: parts[i++] }));
        }, delayMs);
        req.on("close", () => clearInterval(tick));
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no route for ${url.pathname}` } }));
});

const port = Number(process.env.FAKE_UPSTREAM_PORT || 4599);
server.listen(port, () => {
    console.log(`[fake-upstream] listening on ${port}`);
});
