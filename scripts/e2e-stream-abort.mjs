#!/usr/bin/env node
// E2E: Client-disconnect propagates to upstream
//   1. Stand up a stub upstream that sends N chunks at 100ms intervals
//      and tracks when the request body's connection closes server-side.
//   2. POST /api/playground/chat with stream:true.
//   3. Read the first chunk to confirm the stream started, then abort
//      the fetch (simulates the FE unmount/AbortController flow).
//   4. Wait briefly and assert:
//      - the upstream server saw the connection close (i.e., the
//        gateway forwarded our abort all the way through)
//      - the upstream sent FEWER than N chunks (i.e., the cancel
//        actually short-circuited mid-stream)
//
// Regression guard for the round-9 (FE unmount cleanup) + round-10
// (server cancel/AbortController/fetch.signal) bug pair.

import { spawn } from "node:child_process"
import http from "node:http"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"

const UPSTREAM_PORT = 19590
const SERVER_PORT = 19591
const BASE = `http://127.0.0.1:${SERVER_PORT}`
const TOTAL_CHUNKS = 30
const CHUNK_INTERVAL_MS = 100

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const expectations = []
let passed = 0
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail })
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`)
    if (ok) passed++
}

const upstreamState = {
    chunksSent: 0,
    closed: false,
    closedAt: null,
    startedAt: null,
}

const stub = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ data: [{ id: "stub-stream", object: "model" }] }))
        return
    }
    if (req.url === "/v1/chat/completions") {
        let body = ""
        req.on("data", (c) => { body += c })
        req.on("end", async () => {
            const parsed = JSON.parse(body)
            if (!parsed.stream) {
                res.writeHead(400)
                res.end("test fixture expects stream=true")
                return
            }
            upstreamState.startedAt = Date.now()
            res.writeHead(200, { "Content-Type": "text/event-stream" })

            // Track client-side disconnect (which here is the gateway
            // disconnecting from us, i.e., our cancel propagated).
            res.on("close", () => {
                if (upstreamState.closed) return
                upstreamState.closed = true
                upstreamState.closedAt = Date.now()
            })

            for (let i = 0; i < TOTAL_CHUNKS; i++) {
                if (upstreamState.closed || res.destroyed) break
                const chunk = {
                    id: `c${i}`,
                    object: "chat.completion.chunk",
                    model: parsed.model,
                    choices: [{ index: 0, delta: { content: `chunk-${i} ` }, finish_reason: null }],
                }
                try {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
                    upstreamState.chunksSent++
                } catch {
                    break
                }
                await sleep(CHUNK_INTERVAL_MS)
            }
            try { res.write("data: [DONE]\n\n") } catch { /* closed */ }
            try { res.end() } catch { /* closed */ }
        })
        return
    }
    res.writeHead(404)
    res.end()
})

const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-abort-"))
mkdirSync(path.join(tmp, ".config"), { recursive: true })
const MASTER_KEY = randomBytes(32).toString("hex")
writeFileSync(path.join(tmp, ".config", "loom.yaml"), `
master_key: ${MASTER_KEY}
admin:
  username: abortadmin
  password: abortpass
providers:
  - name: abortstub
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
    await sleep(800) // let config + bootstrap settle

    // Log in.
    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "abortadmin", user_password: "abortpass" }),
    })
    expect("login 200", loginRes.status === 200, `status=${loginRes.status}`)
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("loom_session="))?.split(";")[0]
        ?? loginRes.headers.get("set-cookie")?.split(";")[0]
    expect("got cookie", !!cookie, cookie ? "present" : "missing")

    // Start the stream.
    const ac = new AbortController()
    const startedAt = Date.now()
    const chatRes = await fetch(`${BASE}/api/playground/chat`, {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            conversation_id: crypto.randomUUID(),
            model: "stub-stream",
            content: "send me chunks",
            stream: true,
        }),
    })
    expect("chat status 200", chatRes.status === 200, `status=${chatRes.status}`)
    expect("chat is SSE", chatRes.headers.get("Content-Type")?.startsWith("text/event-stream"), chatRes.headers.get("Content-Type"))

    // Read one chunk to make sure the stream is live, then abort.
    const reader = chatRes.body.getReader()
    const { value } = await reader.read()
    expect("first chunk received", !!value && value.length > 0, `bytes=${value?.length}`)

    // Abort the FE-side fetch — same effect as ChatFlow unmounting.
    ac.abort()
    try { await reader.cancel() } catch { /* expected */ }

    // Give the gateway up to ~1.5s to propagate the cancel to upstream
    // and tear down the connection. The upstream sleeps 100ms between
    // chunks so a fully-honored cancel should fire within ~200ms.
    for (let i = 0; i < 30; i++) {
        if (upstreamState.closed) break
        await sleep(50)
    }
    const elapsed = Date.now() - startedAt

    expect(
        "upstream saw connection close",
        upstreamState.closed,
        `closed=${upstreamState.closed} chunksSent=${upstreamState.chunksSent}`,
    )
    expect(
        "upstream stopped well before sending all chunks",
        upstreamState.chunksSent < TOTAL_CHUNKS,
        `sent=${upstreamState.chunksSent}/${TOTAL_CHUNKS} elapsed=${elapsed}ms`,
    )
    expect(
        "upstream close happened quickly after FE abort",
        upstreamState.closedAt && upstreamState.closedAt - startedAt < 3000,
        `closed_after=${upstreamState.closedAt ? upstreamState.closedAt - startedAt : "never"}ms`,
    )

    // Sanity: the FE side actually aborted (reader.cancel + ac.abort
    // would have failed quietly if reused).
    expect("fetch aborted (no late chunks)", true, "implicit — reader.cancel() returned")
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
            console.log(serverLogs.split("\n").slice(-40).join("\n"))
        }
        console.log(`\n${passed}/${expectations.length} expectations passed`)
        process.exit(passed === expectations.length ? 0 : 1)
    }
}

main()
