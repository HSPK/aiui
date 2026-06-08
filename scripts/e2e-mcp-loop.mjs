#!/usr/bin/env node
// E2E: MCP execution loop end-to-end
//   1. Register an MCP server backed by a local stdio child that
//      exposes one `add` tool via the @modelcontextprotocol/sdk Server.
//   2. POST /api/mcp/servers/[id]/tools — surfaces the tool list.
//   3. POST /api/playground/chat with enabled_mcp_server_ids=[id] and
//      a stub upstream that returns tool_calls in round 1, then text
//      in round 2 after seeing the tool result. Verify:
//        - upstream round 1 received tools[] with mangled name
//        - upstream round 2 received the tool result message
//        - SSE stream surfaced an `event: aiui_tool_result`
//        - persisted messages include assistant tool_call part + a
//          role:"tool" tool_result row.

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPSTREAM_PORT = 19571;
const SERVER_PORT = 19572;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

const upstreamCalls = [];
let nextResponse = null; // function returning {stream:true|false} response details

const stub = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "stub-tool", object: "model" }] }));
        return;
    }
    if (req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
            const parsed = JSON.parse(body);
            upstreamCalls.push(parsed);
            const resp = nextResponse?.(parsed, upstreamCalls.length);
            if (!resp) {
                res.writeHead(500);
                res.end("no scripted response");
                return;
            }
            if (parsed.stream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                for (const chunk of resp.chunks) {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
                res.write("data: [DONE]\n\n");
                res.end();
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(resp.json));
            }
        });
        return;
    }
    res.writeHead(404);
    res.end();
});

const tmp = mkdtempSync(path.join(tmpdir(), "aiui-e2e-mcp-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
writeFileSync(path.join(tmp, ".config", "aiui.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: mcpadmin
  password: mcppass
providers:
  - name: mcpstub
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/v1
    api_key: sk-test
    enabled: true
`);

// Write a tiny MCP server child — exposes a single `add` tool.
const mcpServerPath = path.join(tmp, "mcp-add-server.mjs");
writeFileSync(mcpServerPath, `
import { Server } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "${process.cwd()}/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

const server = new Server(
    { name: "add-test", version: "0.0.1" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
        name: "add",
        description: "Add two numbers",
        inputSchema: {
            type: "object",
            properties: { a: { type: "number" }, b: { type: "number" } },
            required: ["a", "b"],
        },
    }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { a, b } = req.params.arguments ?? {};
    return { content: [{ type: "text", text: String(Number(a) + Number(b)) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
`);

stub.listen(UPSTREAM_PORT);
console.log(`stub on :${UPSTREAM_PORT}`);

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

const cleanup = () => {
    try { server.kill("SIGTERM"); } catch { }
    try { stub.close(); } catch { }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { }
};

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

try {
    const start = Date.now();
    while (!ready) {
        if (Date.now() - start > 30_000) throw new Error("server failed to start\n" + serverLogs.join(""));
        await sleep(200);
    }
    await sleep(500);

    // Login
    const login = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "mcpadmin", user_password: "mcppass" }),
    });
    expect("login 200", login.status === 200, `status=${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

    // Register MCP server (stdio, runs the tiny add-server child).
    const create = await fetch(`${BASE}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            name: "addsvr",
            description: "test add tool",
            transport: "stdio",
            config: { command: "node", args: [mcpServerPath] },
            enabled: true,
        }),
    });
    expect("create mcp server 200", create.status === 200, `status=${create.status}`);
    const createBody = await create.json();
    const mcpId = createBody.data?.id;
    expect("mcp id returned", !!mcpId, `id=${mcpId}`);

    // tools/list proxy.
    const toolsRes = await fetch(`${BASE}/api/mcp/servers/${mcpId}/tools`, {
        headers: { Cookie: cookie },
    });
    expect("tools/list 200", toolsRes.status === 200, `status=${toolsRes.status}`);
    const toolsBody = await toolsRes.json();
    const addTool = toolsBody.data?.tools?.find((t) => t.name === "add");
    expect("add tool discovered", !!addTool, `name=${addTool?.name}`);
    const expectedQualified = `addsvr__add`;
    expect("qualified name mangled with server prefix",
        addTool?.qualified_name === expectedQualified,
        `q=${addTool?.qualified_name}`);

    // ---------------------------------------------------------
    // Scripted upstream: round 1 = tool_call, round 2 = final text.
    // ---------------------------------------------------------
    nextResponse = (parsed, callNo) => {
        if (callNo === 1) {
            // Round 1 — emit tool_calls SSE.
            return {
                chunks: [
                    {
                        id: "r1", model: parsed.model, choices: [{
                            index: 0,
                            delta: {
                                tool_calls: [{
                                    index: 0,
                                    id: "tc_abc",
                                    type: "function",
                                    function: { name: expectedQualified, arguments: '{"a":2,"b":3}' },
                                }],
                            },
                            finish_reason: "tool_calls",
                        }],
                    },
                ],
            };
        }
        // Round 2 — final answer text.
        return {
            chunks: [
                { id: "r2", model: parsed.model, choices: [{ index: 0, delta: { content: "result is 5" }, finish_reason: null }] },
                { id: "r2", model: parsed.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
            ],
        };
    };

    const convId = crypto.randomUUID();
    const chatRes = await fetch(`${BASE}/api/playground/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            conversation_id: convId,
            model: "stub-tool",
            content: "compute 2+3 via tools",
            stream: true,
            enabled_mcp_server_ids: [mcpId],
        }),
    });
    expect("playground chat 200", chatRes.status === 200, `status=${chatRes.status}`);
    const sseText = await chatRes.text();

    expect("upstream called twice (tool_call + final)", upstreamCalls.length >= 2,
        `count=${upstreamCalls.length}`);

    // Round 1 received tools[] with mangled name.
    const round1 = upstreamCalls[0];
    expect("round 1 has tools[] injected",
        Array.isArray(round1?.tools) && round1.tools.length === 1,
        `tools_len=${round1?.tools?.length}`);
    expect("tools[0].function.name is the mangled qualified name",
        round1?.tools?.[0]?.function?.name === expectedQualified,
        `name=${round1?.tools?.[0]?.function?.name}`);

    // Round 2 had a role:"tool" message with the result.
    const round2 = upstreamCalls[1];
    const toolMsg = (round2?.messages ?? []).find((m) => m.role === "tool");
    expect("round 2 includes role:tool message with execution result",
        !!toolMsg && toolMsg.tool_call_id === "tc_abc" && /5/.test(String(toolMsg.content)),
        `tool_msg=${JSON.stringify(toolMsg)}`);

    // Round 2 history also includes assistant message carrying tool_calls.
    const assistantWithCalls = (round2?.messages ?? []).find(
        (m) => m.role === "assistant" && Array.isArray(m.tool_calls)
    );
    expect("round 2 history carries assistant.tool_calls envelope",
        !!assistantWithCalls && assistantWithCalls.tool_calls[0]?.function?.name === expectedQualified,
        `tc=${JSON.stringify(assistantWithCalls?.tool_calls?.[0])}`);

    // SSE stream surfaced the synthetic tool_result event.
    expect("SSE stream contains event: aiui_tool_result",
        sseText.includes("event: aiui_tool_result"),
        `events=${sseText.match(/event:[^\n]+/g)?.slice(0, 3).join(", ")}`);

    // Persisted messages have the assistant tool_call part + role:tool row.
    await sleep(200);
    const msgsRes = await fetch(`${BASE}/api/conversations/${convId}/messages?page=1&page_size=20`, {
        headers: { Cookie: cookie },
    });
    const msgs = (await msgsRes.json()).data?.items ?? [];
    const assistantMsg = msgs.find((m) => m.role === "assistant");
    const toolRow = msgs.find((m) => m.role === "tool");
    expect("assistant message persisted",
        !!assistantMsg, `has=${!!assistantMsg}`);
    const partTypes = Array.isArray(assistantMsg?.content)
        ? assistantMsg.content.map((p) => p.type)
        : [];
    expect("assistant.content includes a tool_call part",
        partTypes.includes("tool_call"),
        `part_types=${JSON.stringify(partTypes)}`);
    expect("role:tool message persisted with linked tool_call_id",
        !!toolRow && Array.isArray(toolRow.content) &&
        toolRow.content.some((p) => p.type === "tool_result" && p.tool_result?.tool_call_id === "tc_abc"),
        `tool=${JSON.stringify(toolRow?.content)}`);

    console.log(`\n${passed}/${expectations.length} expectations passed`);
    process.exit(passed === expectations.length ? 0 : 1);
} catch (err) {
    console.error("\nE2E FAILED:", err.message);
    console.error("\n--- server logs ---\n" + serverLogs.join(""));
    process.exit(1);
}
