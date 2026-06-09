#!/usr/bin/env node
// E2E: Multi-model concurrent send is race-safe
//   The FE's `streamMultiple` fires N parallel POSTs to
//   /api/playground/chat with the SAME conversation_id + the SAME
//   user_message_id (one per chosen model). Before round 14 this
//   crashed N-1 of them with PK violations because the orchestrator
//   did SELECT-then-INSERT for both rows.
//
//   This test sends 5 concurrent requests targeting one fresh
//   conversation_id and asserts:
//     - all 5 return 200 (no PK violation)
//     - the conversation row exists exactly once
//     - the user message row exists exactly once
//     - 5 distinct assistant rows exist (one per model)

import { spawn } from "node:child_process"
import http from "node:http"
import Database from "better-sqlite3"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes, randomUUID } from "node:crypto"

const UPSTREAM_PORT = 19601
const SERVER_PORT = 19602
const BASE = `http://127.0.0.1:${SERVER_PORT}`
const PARALLEL_REQUESTS = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const expectations = []
let passed = 0
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail })
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`)
    if (ok) passed++
}

// Stub upstream emits one chunk then [DONE].
const stub = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ data: [
            { id: "stub-a", object: "model" },
            { id: "stub-b", object: "model" },
            { id: "stub-c", object: "model" },
            { id: "stub-d", object: "model" },
            { id: "stub-e", object: "model" },
        ] }))
        return
    }
    if (req.url === "/v1/chat/completions") {
        let body = ""
        req.on("data", (c) => { body += c })
        req.on("end", () => {
            const parsed = JSON.parse(body)
            res.writeHead(200, { "Content-Type": "text/event-stream" })
            res.write(`data: ${JSON.stringify({
                id: "r",
                model: parsed.model,
                choices: [{ index: 0, delta: { content: `hello from ${parsed.model}` }, finish_reason: null }],
            })}\n\n`)
            res.write(`data: ${JSON.stringify({
                id: "r",
                model: parsed.model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`)
            res.write("data: [DONE]\n\n")
            res.end()
        })
        return
    }
    res.writeHead(404)
    res.end()
})

const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-multimodel-"))
mkdirSync(path.join(tmp, ".config"), { recursive: true })
const MASTER_KEY = randomBytes(32).toString("hex")
writeFileSync(path.join(tmp, ".config", "loom.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: multiadmin
  password: multipass
providers:
  - name: multistub
    base_url: http://127.0.0.1:${UPSTREAM_PORT}/v1
    api_key: sk-test
    enabled: true
`)

let serverProc = null
let serverLogs = ""

const waitForServer = async () => {
    for (let i = 0; i < 80; i++) {
        try {
            const r = await fetch(`${BASE}/api/ping`)
            if (r.ok || r.status === 401) return
        } catch { /* not ready */ }
        await sleep(150)
    }
    throw new Error("server didn't become ready")
}

async function run() {
    await new Promise((r) => stub.listen(UPSTREAM_PORT, r))

    serverProc = spawn(process.execPath, [
        path.join(process.cwd(), "node_modules/.bin/next"),
        "start",
        "-p", String(SERVER_PORT),
    ], {
        env: {
            ...process.env,
            LOOM_CONFIG: path.join(tmp, ".config", "loom.yaml"),
            LOOM_DB_PATH: path.join(tmp, "data", "loom.db"),
            LOOM_USER_CWD: tmp,
            NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
    })
    serverProc.stdout.on("data", (c) => { serverLogs += c.toString() })
    serverProc.stderr.on("data", (c) => { serverLogs += c.toString() })

    await waitForServer()
    await sleep(800)

    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "multiadmin", user_password: "multipass" }),
    })
    expect("login 200", loginRes.status === 200, `status=${loginRes.status}`)
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("loom_session="))?.split(";")[0]
    expect("got cookie", !!cookie, cookie ? "present" : "missing")

    // Fire N parallel requests sharing the same conv_id + user_message_id.
    // Each picks a distinct assistant_message_id + model (the FE pattern).
    const convId = randomUUID()
    const userMsgId = randomUUID()
    const models = ["stub-a", "stub-b", "stub-c", "stub-d", "stub-e"]

    const startedAt = Date.now()
    const results = await Promise.all(
        models.map(async (model) => {
            const res = await fetch(`${BASE}/api/playground/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Cookie: cookie },
                body: JSON.stringify({
                    conversation_id: convId,
                    user_message_id: userMsgId,
                    assistant_message_id: randomUUID(),
                    model,
                    content: "race me",
                    stream: true,
                }),
            })
            // Drain the body so the orchestrator actually finishes.
            if (res.body) {
                const reader = res.body.getReader()
                while (true) {
                    const { done } = await reader.read()
                    if (done) break
                }
            }
            return res.status
        }),
    )
    const elapsed = Date.now() - startedAt

    expect(
        "all parallel requests returned 200",
        results.every((s) => s === 200),
        `statuses=${JSON.stringify(results)} elapsed=${elapsed}ms`,
    )

    // Inspect DB directly.
    await sleep(300) // let writes settle
    const db = new Database(path.join(tmp, "data", "loom.db"), { readonly: true })
    const convCount = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE id = ?").get(convId).c
    expect("conversation row exists exactly once", convCount === 1, `count=${convCount}`)

    const userMsgCount = db.prepare("SELECT COUNT(*) AS c FROM messages WHERE id = ?").get(userMsgId).c
    expect("user message row exists exactly once", userMsgCount === 1, `count=${userMsgCount}`)

    const assistantRows = db.prepare(
        "SELECT id, model_id FROM messages WHERE conversation_id = ? AND role = 'assistant'"
    ).all(convId)
    expect(
        "all 5 assistant rows persisted (one per model)",
        assistantRows.length === PARALLEL_REQUESTS,
        `count=${assistantRows.length} ids=${assistantRows.map(r => r.model_id).join(",")}`,
    )
    expect(
        "every assistant row has its own id",
        new Set(assistantRows.map((r) => r.id)).size === PARALLEL_REQUESTS,
        `unique=${new Set(assistantRows.map((r) => r.id)).size}`,
    )

    db.close()
}

async function main() {
    try {
        await run()
    } catch (err) {
        console.error("Test threw:", err)
    } finally {
        if (serverProc) {
            serverProc.kill()
            await new Promise((r) => serverProc.once("exit", r))
        }
        await new Promise((r) => stub.close(r))
        rmSync(tmp, { recursive: true, force: true })
        if (passed !== expectations.length) {
            console.log("\nserver logs (tail):")
            console.log(serverLogs.split("\n").slice(-60).join("\n"))
        }
        console.log(`\n${passed}/${expectations.length} expectations passed`)
        process.exit(passed === expectations.length ? 0 : 1)
    }
}

main()
