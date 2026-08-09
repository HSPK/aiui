// Populates a throwaway Loom instance with presentable data for the
// README / docs screenshots.
//
// Everything goes through the real HTTP API so the resulting rows are
// exactly what a running install produces — provider keys are encrypted,
// generation logs carry real token counts and measured latencies. Only
// two things are synthesised afterwards: log timestamps are spread over
// the trailing weeks so the dashboard trend has a shape, and a few
// per-day counts are varied so the chart isn't a flat line.
//
//   node scripts/demo-seed.mjs http://127.0.0.1:3100

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const UPSTREAM = process.env.DEMO_UPSTREAM || "http://demo-upstream:8099";

let cookie = "";

async function api(path, { method = "GET", body, key } = {}) {
    const headers = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    else if (cookie) headers.cookie = cookie;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
        throw new Error(`${method} ${path} -> ${res.status} ${json.msg || text.slice(0, 200)}`);
    }
    return json.data;
}

const PROVIDERS = [
    { name: "OpenAI", slug: "openai", description: "Primary provider for chat and embeddings." },
    { name: "Anthropic", slug: "anthropic", description: "Long-context reasoning and code review." },
    { name: "Azure OpenAI", slug: "azure", description: "EU-resident deployment for regulated workloads." },
    { name: "Groq", slug: "groq", description: "Low-latency path for interactive features." },
    { name: "Mistral", slug: "mistral", description: "Cost-sensitive bulk classification." },
    { name: "Self-hosted vLLM", slug: "vllm", description: "On-prem A100 node for offline batch jobs." },
];

const CONVERSATIONS = [
    {
        title: "Token bucket rate limiter",
        model: "claude-sonnet-4",
        turns: [
            "Write me a concurrency-safe rate limiter in Go, and tell me what's easy to get wrong.",
            "Our p95 latency regressed but throughput is fine. Where do I start?",
        ],
    },
    {
        title: "Embedding storage strategy",
        model: "gpt-4o-mini",
        turns: [
            "Should I normalise embeddings before storing them, or at query time?",
            "What's the actual difference between MCP and plain function calling?",
        ],
    },
    {
        title: "Debugging first-token latency",
        model: "o3-mini",
        turns: ["Our p95 latency regressed but throughput is fine. Where do I start?"],
    },
];

// One conversation is answered by three models at once, which is the
// side-by-side comparison view — the reason to open the playground
// rather than curl the gateway.
const COMPARISON = {
    title: "MCP vs. function calling",
    prompt: "What's the actual difference between MCP and plain function calling?",
    models: ["gpt-4o", "claude-sonnet-4", "llama-3.3-70b-instruct"],
};

async function main() {
    console.log("→ login");
    await api("/api/login", { method: "POST", body: { user_name: "admin", user_password: "demo-admin-pw" } });

    // Idempotent: the script is re-run while iterating on the captures.
    console.log("→ reset");
    for (const p of await api("/api/providers")) await api(`/api/providers/${p.id}`, { method: "DELETE" });
    for (const s of await api("/api/mcp/servers")) await api(`/api/mcp/servers/${s.id}`, { method: "DELETE" });
    for (const k of (await api("/api/apikeys?page=1&page_size=100")).items ?? []) await api(`/api/apikeys/${k.id}`, { method: "DELETE" });
    for (const c of (await api("/api/conversations?page=1&page_size=100")).items ?? []) await api(`/api/conversations/${c.id}`, { method: "DELETE" });
    for (const u of (await api("/api/users?page=1&page_size=100")).items ?? []) {
        if (u.username !== "admin") await api(`/api/users/${u.username}`, { method: "DELETE" });
    }

    console.log("→ providers");
    for (const p of PROVIDERS) {
        await api("/api/providers", {
            method: "POST",
            body: {
                name: p.name, provider_name: p.name, base_url: `${UPSTREAM}/${p.slug}/v1`,
                api_key: `sk-demo-${p.name.toLowerCase().replace(/\W+/g, "-")}`,
                description: p.description, adapter_id: "openai",
            },
        });
    }
    await api("/api/providers/reload", { method: "POST" });

    console.log("→ team members");
    for (const u of [
        { user_name: "sarah", role: "admin" },
        { user_name: "marco", role: "user" },
        { user_name: "priya", role: "user" },
        { user_name: "ci-bot", role: "user" },
    ]) {
        await api("/api/users", { method: "POST", body: { username: u.user_name, password: "demo-password-123", role: u.role } });
    }

    console.log("→ api keys");
    // Issued by different people so the log list shows a team rather than
    // one account calling itself.
    const adminCookie = cookie;
    const keys = [];
    for (const [owner, name] of [
        ["admin", "production-web"],
        ["sarah", "staging"],
        ["marco", "nightly-eval"],
        ["priya", "docs-search"],
        ["ci-bot", "ci-regression"],
    ]) {
        if (owner !== "admin") {
            await api("/api/login", { method: "POST", body: { user_name: owner, user_password: "demo-password-123" } });
        } else {
            cookie = adminCookie;
        }
        keys.push((await api("/api/apikeys", { method: "POST", body: { name } })).key);
    }
    cookie = adminCookie;

    console.log("→ conversations");
    const convIds = [];
    for (const conv of CONVERSATIONS) {
        let conversationId;
        for (const turn of conv.turns) {
            const res = await fetch(`${BASE}/api/playground/chat`, {
                method: "POST",
                headers: { "content-type": "application/json", cookie },
                body: JSON.stringify({
                    model: conv.model,
                    content: [{ type: "text", text: turn }],
                    stream: true,
                    ...(conversationId ? { conversation_id: conversationId } : {}),
                }),
            });
            conversationId = res.headers.get("x-conversation-id") || conversationId;
            await res.text();
        }
        if (conversationId) {
            convIds.push(conversationId);
            await api(`/api/conversations/${conversationId}`, { method: "PATCH", body: { title: conv.title } });
        }
    }
    // Same user message, three assistant replies -> the comparison view.
    {
        const userMessageId = crypto.randomUUID();
        let conversationId;
        for (const model of COMPARISON.models) {
            const res = await fetch(`${BASE}/api/playground/chat`, {
                method: "POST",
                headers: { "content-type": "application/json", cookie },
                body: JSON.stringify({
                    model,
                    content: [{ type: "text", text: COMPARISON.prompt }],
                    stream: true,
                    user_message_id: userMessageId,
                    ...(conversationId ? { conversation_id: conversationId } : {}),
                }),
            });
            conversationId = res.headers.get("x-conversation-id") || conversationId;
            await res.text();
        }
        if (conversationId) {
            convIds.push(conversationId);
            await api(`/api/conversations/${conversationId}`, { method: "PATCH", body: { title: COMPARISON.title } });
        }
    }
    console.log(`   ${convIds.length} conversations`);

    console.log("→ traffic history");
    const prompts = [
        "Summarise this support thread in three bullets.",
        "Classify the sentiment of this review.",
        "Extract every date mentioned as ISO-8601.",
        "Rewrite this paragraph for a non-technical reader.",
        "What is the time complexity of this function?",
        "Draft a release note for the changes below.",
    ];
    const chatModels = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-haiku-4", "o3-mini", "llama-3.3-70b-instruct", "mistral-large", "llama-3.3-70b-versatile"];
    let n = 0;
    for (let i = 0; i < 240; i++) {
        const key = keys[i % keys.length];
        const model = chatModels[i % chatModels.length];
        await fetch(`${BASE}/api/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: "user", content: prompts[i % prompts.length] }], max_tokens: 300 }),
        }).then((r) => r.text());
        n++;
    }
    for (let i = 0; i < 60; i++) {
        await fetch(`${BASE}/api/v1/embeddings`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${keys[i % keys.length]}` },
            body: JSON.stringify({
                model: i % 2 ? "text-embedding-3-small" : "text-embedding-3-large",
                input: ["knowledge base article " + i, "support ticket " + i],
            }),
        }).then((r) => r.text());
        n++;
    }
    console.log(`   ${n} gateway requests`);

    console.log("→ mcp servers");
    for (const s of [
        { name: "filesystem", description: "Read/write access to allowed directories.", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"] } },
        { name: "git", description: "Inspect repository history, diffs and blame.", config: { command: "uvx", args: ["--with", "mcp<2", "mcp-server-git", "--repository", "/data/repo"] } },
        { name: "time", description: "Time-zone aware date and time queries.", config: { command: "uvx", args: ["--with", "mcp<2", "mcp-server-time", "--local-timezone=UTC"] } },
        { name: "fetch", description: "HTTP fetch with HTML to markdown conversion.", config: { command: "uvx", args: ["--with", "mcp<2", "mcp-server-fetch"] } },
        { name: "memory", description: "Knowledge-graph memory shared across sessions.", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } },
        { name: "sequential-thinking", description: "Structured step-by-step reasoning scratchpad.", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] } },
    ]) {
        await api("/api/mcp/servers", { method: "POST", body: { ...s, transport: "stdio", enabled: true } });
    }

    // Health-check every server so the list shows real tool counts
    // instead of "never checked".
    console.log("→ checking mcp servers");
    for (const s of await api("/api/mcp/servers")) {
        // The endpoint answers 200 with the server row even when the
        // handshake failed, so the HTTP status says nothing — read the
        // health fields it wrote.
        try {
            const row = await api(`/api/mcp/servers/${s.id}/check`, { method: "POST" });
            const tools = (row.tools_cache ?? []).length;
            if (row.last_check_status === "ok") process.stdout.write(`   ${s.name}: ok (${tools} tools)\n`);
            else process.stdout.write(`   ${s.name}: FAILED ${row.last_check_error ?? ""}\n`);
        } catch (e) {
            process.stdout.write(`   ${s.name}: ERROR ${e.message}\n`);
        }
    }

    console.log("done");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
