// OpenAI-compatible upstream that serves curated answers, used only to
// populate a throwaway instance for the screenshots in README/docs.
//
// Everything the screenshots show still travels the real path — gateway,
// variant transcode, SSE, logging — so latencies, token counts and log
// rows are genuine. Only the upstream text is scripted, so the captures
// are reproducible and don't spend anyone's quota.
//
//   node scripts/demo-upstream.mjs [port]

import { createServer } from "node:http";

const PORT = Number(process.argv[2] || 8099);

// Keyed by the path prefix each provider is registered under, so a
// model resolves to exactly one provider and the "Provider / model"
// attribution in the UI reads the way it would with real upstreams.
const CATALOGUE = {
    openai: ["gpt-4o", "gpt-4o-mini", "o3-mini", "text-embedding-3-small", "text-embedding-3-large"],
    anthropic: ["claude-sonnet-4", "claude-haiku-4", "claude-opus-4"],
    azure: ["gpt-4o", "gpt-4o-mini", "text-embedding-3-large"],
    groq: ["llama-3.3-70b-versatile", "mixtral-8x7b"],
    mistral: ["mistral-large", "codestral"],
    vllm: ["llama-3.3-70b-instruct", "qwen2.5-coder-32b"],
};

const catalogueFor = (pathname) => {
    const key = Object.keys(CATALOGUE).find((k) => pathname.startsWith(`/${k}/`));
    return key ? CATALOGUE[key] : Object.values(CATALOGUE).flat();
};

const ANSWERS = [
    {
        match: /mcp|model context protocol/i,
        text: `**MCP** and plain function calling solve the same problem at different layers.

| | Function calling | MCP |
|---|---|---|
| Where tools live | Inline in your app | A separate server process |
| Reuse across apps | Copy the schema | Point at the same server |
| Transport | In-process | stdio or HTTP |
| Discovery | Hard-coded | \`tools/list\` at runtime |

Function calling is the *wire format* — the model emits a name and JSON arguments. MCP is the *distribution model*: it standardises how a tool server advertises what it can do, so the same filesystem or Postgres server works in any client that speaks the protocol.

Use function calling when the tool is one function specific to your product. Reach for MCP when you want the tool to outlive the app that first needed it.`,
    },
    {
        match: /rate limit/i,
        text: `Here's a token-bucket limiter that's safe under concurrency:

\`\`\`go
type Bucket struct {
	mu       sync.Mutex
	tokens   float64
	capacity float64
	refill   float64 // tokens per second
	last     time.Time
}

func (b *Bucket) Allow(n float64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	b.tokens = math.Min(b.capacity, b.tokens+now.Sub(b.last).Seconds()*b.refill)
	b.last = now

	if b.tokens < n {
		return false
	}
	b.tokens -= n
	return true
}
\`\`\`

Two details that matter:

1. **Refill lazily.** No background goroutine per bucket — compute the accrual from the elapsed time on each call.
2. **Clamp to capacity.** Without the \`math.Min\`, an idle bucket accumulates unbounded credit and the first burst after a quiet period sails straight through.`,
    },
    {
        match: /ttft|latency|slow/i,
        text: `Split the number before you chase it. End-to-end latency is:

\`\`\`
total = queue + prefill + decode
\`\`\`

- **TTFT** (time to first token) covers queue + prefill. It scales with *prompt* length.
- **TBT** (time between tokens) is pure decode. It scales with *output* length and is nearly flat per token.

So a slow response is either a long prompt or a long answer, and the two want opposite fixes: trim context vs. cap \`max_tokens\`. Logging both separately is what tells you which one you have — averaging them together hides it.`,
    },
    {
        match: /embedding|vector/i,
        text: `Normalise before you store, not at query time.

Cosine similarity is a dot product once both vectors are unit length, and most vector stores let you pick the cheaper inner-product metric if you guarantee that invariant on write. You pay the normalisation once per document instead of once per query, and every subsequent search gets faster.

The trap: if you ever mix normalised and un-normalised vectors in the same index, the ranking silently degrades — there's no error, just worse results.`,
    },
    {
        match: /.*/,
        text: `Loom sits between your apps and every model provider you use, speaking the OpenAI API on both sides.

- **One endpoint.** Point any OpenAI-compatible client at Loom; it routes to the right upstream.
- **Every request logged.** Prompt, response, tokens, TTFT and total latency — per model, per key.
- **Self-hosted.** One SQLite file holds the whole installation.`,
    },
];

// A comparison screenshot is pointless if every column says the same
// thing, so each model gets a short signature line. Same substance,
// different voice — which is what you actually see when you fan a prompt
// out across providers.
const VOICE = {
    "gpt-4o": "\n\nIn short: same wire format, different distribution model.",
    "claude-sonnet-4": "\n\nWorth noting: the two compose. An MCP server's tools arrive as ordinary function definitions, so nothing about your calling code changes.",
    "llama-3.3-70b-instruct": "\n\nRule of thumb: one app, one tool -> function calling. Many apps, shared tool -> MCP.",
    "claude-haiku-4": "\n\nShort version: function calling is the protocol, MCP is the packaging.",
    "o3-mini": "\n\nIf you only remember one thing: MCP decouples the tool's lifecycle from the app's.",
};

const answerFor = (prompt, model) =>
    ANSWERS.find((a) => a.match.test(prompt)).text + (VOICE[model] ?? "");

function lastUserText(body) {
    const msgs = body.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role !== "user") continue;
        const c = msgs[i].content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.filter((p) => p.type === "text").map((p) => p.text).join(" ");
    }
    return "";
}

const readBody = (req) => new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
});

const approxTokens = (s) => Math.max(1, Math.round(s.length / 4));

function chunkify(text) {
    // Split on word boundaries so the FE renders a realistic token cadence.
    return text.match(/\S+\s*/g) || [text];
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");

    if (req.method === "GET" && url.pathname.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
            object: "list",
            data: catalogueFor(url.pathname).map((id) => ({ id, object: "model", created: 1735689600, owned_by: "demo" })),
        }));
        return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/embeddings")) {
        const body = await readBody(req);
        const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
            object: "list",
            model: body.model,
            data: inputs.map((_, i) => ({
                object: "embedding",
                index: i,
                embedding: Array.from({ length: 8 }, (_, j) => Number((Math.sin(i * 7 + j) / 2).toFixed(6))),
            })),
            usage: { prompt_tokens: inputs.join(" ").length / 4 | 0, total_tokens: inputs.join(" ").length / 4 | 0 },
        }));
        return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
        const body = await readBody(req);
        const text = answerFor(lastUserText(body), body.model);
        const promptTokens = approxTokens(JSON.stringify(body.messages || []));
        const completionTokens = approxTokens(text);

        if (!body.stream) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
                id: "chatcmpl-demo", object: "chat.completion",
                created: Math.floor(Date.now() / 1000), model: body.model,
                choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
                usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
            }));
            return;
        }

        res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
        });
        const send = (delta, extra = {}) => res.write(`data: ${JSON.stringify({
            id: "chatcmpl-demo", object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000), model: body.model,
            choices: [{ index: 0, delta, finish_reason: null }], ...extra,
        })}\n\n`);

        send({ role: "assistant", content: "" });
        for (const piece of chunkify(text)) {
            send({ content: piece });
            await new Promise((r) => setTimeout(r, 6));
        }
        res.write(`data: ${JSON.stringify({
            id: "chatcmpl-demo", object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000), model: body.model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no demo route for ${req.method} ${url.pathname}` } }));
});

server.listen(PORT, "0.0.0.0", () => console.log(`[demo-upstream] listening on ${PORT}`));
