#!/usr/bin/env node
// E2E: verify the multimodal content pipeline
//   1. POST /api/playground/chat with content as a ContentPart array
//      (text + image_url + file) propagates to the upstream as
//      messages[0].content array, NOT as flattened text
//   2. The persisted user message in the conversation stores the array
//      verbatim (round-trips through GET /conversations/:id/messages)
//   3. Bare-string content still works (back-compat path inside the
//      same field — the schema accepts string | array)
//   4. The /v1/chat/completions gateway endpoint forwards multimodal
//      content untouched too (used by playground + external callers)

import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPSTREAM_PORT = 19561;
const SERVER_PORT = 19562;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

let lastChatBody = null;

const stub = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            object: "list",
            data: [{ id: "stub-vision", object: "model" }],
        }));
        return;
    }
    if (req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", async () => {
            lastChatBody = JSON.parse(body);
            if (lastChatBody.stream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                res.write(`data: ${JSON.stringify({ id: "id1", model: lastChatBody.model, choices: [{ delta: { content: "ok" } }] })}\n\n`);
                res.write("data: [DONE]\n\n");
                res.end();
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    id: "id1",
                    choices: [{ message: { role: "assistant", content: "ok" } }],
                    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
                }));
            }
        });
        return;
    }
    res.writeHead(404);
    res.end();
});

const tmp = mkdtempSync(path.join(tmpdir(), "aiui-e2e-mm-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
writeFileSync(path.join(tmp, ".config", "aiui.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: mmadmin
  password: mmpass
providers:
  - name: mmstub
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/v1
    api_key: sk-test
    enabled: true
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

// 1x1 PNG (transparent) data URL — minimal valid base64 image.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
// tiny fake PDF (not really, but enough for the chip path).
const TINY_FILE = "data:application/pdf;base64,JVBERi0xLjQK";

try {
    if (!ready) {
        console.log("--- server logs ---\n" + serverLogs.join(""));
        throw new Error("server failed to start");
    }
    expect("server is up", ready);

    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "mmadmin", user_password: "mmpass" }),
    });
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("aiui_session="))?.split(";")[0];
    expect("login succeeded", loginRes.ok && !!cookie);

    // -------------------------------------------------------------------
    // 1. content as an array (text + image_url + file)
    // -------------------------------------------------------------------
    lastChatBody = null;
    const convId = crypto.randomUUID();
    const userMsgId = crypto.randomUUID();
    const multimodalContent = [
        { type: "text", text: "describe this image and file" },
        { type: "image_url", image_url: { url: TINY_PNG, detail: "auto" } },
        { type: "file", file: { filename: "tiny.pdf", file_data: TINY_FILE, mime_type: "application/pdf" } },
    ];

    const sendRes = await fetch(`${BASE}/api/playground/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            conversation_id: convId,
            user_message_id: userMsgId,
            model: "stub-vision",
            content: multimodalContent,
            stream: false,
        }),
    });
    expect("playground POST 200", sendRes.status === 200, `status=${sendRes.status}`);
    await sendRes.text();

    // Upstream body had messages[0].content as array, NOT flattened text.
    expect(
        "upstream messages[0].content is array (not string)",
        Array.isArray(lastChatBody?.messages?.[0]?.content),
        `type=${typeof lastChatBody?.messages?.[0]?.content}`,
    );
    expect(
        "upstream has 3 content parts (text + image + file)",
        lastChatBody?.messages?.[0]?.content?.length === 3,
        `len=${lastChatBody?.messages?.[0]?.content?.length}`,
    );
    expect(
        "upstream image part keeps image_url.url",
        lastChatBody?.messages?.[0]?.content?.[1]?.image_url?.url === TINY_PNG,
    );
    expect(
        "upstream file part keeps file.filename + file_data",
        lastChatBody?.messages?.[0]?.content?.[2]?.file?.filename === "tiny.pdf" &&
            lastChatBody?.messages?.[0]?.content?.[2]?.file?.file_data === TINY_FILE,
    );

    // -------------------------------------------------------------------
    // 2. persisted message round-trips as array
    // -------------------------------------------------------------------
    await sleep(200);
    const listMsgs = await fetch(`${BASE}/api/conversations/${convId}/messages?page=1&page_size=20`, {
        headers: { Cookie: cookie },
    });
    const msgs = (await listMsgs.json()).data?.items ?? [];
    const persistedUser = msgs.find((m) => m.id === userMsgId);
    expect("user message persisted", !!persistedUser);
    expect(
        "persisted user content is an array",
        Array.isArray(persistedUser?.content),
        `type=${typeof persistedUser?.content}`,
    );
    expect(
        "persisted text part survives round-trip",
        persistedUser?.content?.[0]?.text === "describe this image and file",
    );
    expect(
        "persisted image part survives round-trip",
        persistedUser?.content?.[1]?.image_url?.url === TINY_PNG,
    );
    expect(
        "persisted file part survives round-trip",
        persistedUser?.content?.[2]?.file?.filename === "tiny.pdf",
    );

    // -------------------------------------------------------------------
    // 2b. log persists the multimodal upstream body verbatim
    // -------------------------------------------------------------------
    const logsRes = await fetch(`${BASE}/api/logs/generations?page=1&page_size=5&sort=-created_at`, {
        headers: { Cookie: cookie },
    });
    const recentLog = (await logsRes.json()).data?.items?.[0];
    expect("log captured for multimodal turn", !!recentLog);

    const logDetailRes = await fetch(`${BASE}/api/logs/generations/${recentLog.id}`, {
        headers: { Cookie: cookie },
    });
    const detail = (await logDetailRes.json()).data;
    expect(
        "log.input is an object (multimodal body, not flattened string)",
        detail?.input && typeof detail.input === "object" && Array.isArray(detail.input.messages),
        `type=${typeof detail?.input}`,
    );
    const loggedFirstMsg = detail?.input?.messages?.[0];
    expect(
        "log.input.messages[0].content is the multimodal array",
        Array.isArray(loggedFirstMsg?.content) && loggedFirstMsg.content.length === 3,
        `len=${loggedFirstMsg?.content?.length}`,
    );
    expect(
        "log preserves image dataURL verbatim (for download)",
        loggedFirstMsg?.content?.[1]?.image_url?.url === TINY_PNG,
    );
    expect(
        "log.input_summary is text-only (attachments excluded from summary)",
        typeof detail?.input_summary === "string" &&
            detail.input_summary.includes("describe this image") &&
            !detail.input_summary.includes("base64"),
        `summary=${detail?.input_summary}`,
    );

    // -------------------------------------------------------------------
    // 3. bare-string content still works
    // -------------------------------------------------------------------
    lastChatBody = null;
    const stringRes = await fetch(`${BASE}/api/playground/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            conversation_id: crypto.randomUUID(),
            model: "stub-vision",
            content: "plain text turn",
            stream: false,
        }),
    });
    expect("bare-string POST 200", stringRes.status === 200);
    await stringRes.text();
    expect(
        "bare-string round-trips as array of one text part on upstream",
        // Server normalizes to array form for persistence; upstream
        // therefore sees a one-part array.
        Array.isArray(lastChatBody?.messages?.[0]?.content) &&
            lastChatBody?.messages?.[0]?.content?.[0]?.text === "plain text turn",
        JSON.stringify(lastChatBody?.messages?.[0]?.content),
    );

    // -------------------------------------------------------------------
    // 4. /v1/chat/completions gateway forwards multimodal verbatim
    // -------------------------------------------------------------------
    lastChatBody = null;
    const gatewayRes = await fetch(`${BASE}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            model: "stub-vision",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "what's in this image?" },
                        { type: "image_url", image_url: { url: TINY_PNG } },
                    ],
                },
            ],
        }),
    });
    expect("gateway POST 200", gatewayRes.status === 200);
    await gatewayRes.text();
    expect(
        "gateway forwards multimodal content unchanged to upstream",
        Array.isArray(lastChatBody?.messages?.[0]?.content) &&
            lastChatBody?.messages?.[0]?.content?.[1]?.image_url?.url === TINY_PNG,
    );

    // -------------------------------------------------------------------
    // 5. system prompt + history_limit propagate from playground POST
    // -------------------------------------------------------------------
    const conv2 = crypto.randomUUID();
    // Seed three prior turns so history_limit is observable.
    for (let i = 0; i < 3; i++) {
        await fetch(`${BASE}/api/playground/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({
                conversation_id: conv2,
                model: "stub-vision",
                content: `turn ${i}`,
                stream: false,
            }),
        }).then((r) => r.text());
    }

    lastChatBody = null;
    const tunedRes = await fetch(`${BASE}/api/playground/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            conversation_id: conv2,
            model: "stub-vision",
            content: "next turn",
            system: "Be concise and helpful.",
            history_limit: 2,
            stream: false,
        }),
    });
    expect("tuned POST 200", tunedRes.status === 200);
    await tunedRes.text();

    const sysMsg = lastChatBody?.messages?.find((m) => m.role === "system");
    expect(
        "system prompt becomes first messages[] entry on upstream",
        sysMsg?.content === "Be concise and helpful." && lastChatBody?.messages?.[0] === sysMsg,
        `messages[0]=${JSON.stringify(lastChatBody?.messages?.[0])}`,
    );
    const nonSystemMsgs = (lastChatBody?.messages ?? []).filter((m) => m.role !== "system");
    expect(
        "history_limit caps the non-system messages at 2",
        nonSystemMsgs.length === 2,
        `count=${nonSystemMsgs.length}`,
    );
} catch (err) {
    console.error("Test threw:", err);
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
