#!/usr/bin/env node
// E2E: gateway routes for the four new playground modalities
// — image generation, TTS, transcription, video (Sora).
//
// We stand up a tiny local "upstream" HTTP server that pretends to be
// OpenAI-compatible (handles /v1/models discovery + each modality's
// endpoint shape), register it as a Loom provider, then exercise the
// Loom v1/* routes through the gateway and assert the right responses.
//
// We can't test against real Sora — but we can verify multipart
// forwarding, multipart-vs-JSON branching, video poll/download/delete
// routing, and base64/url image rendering.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const SERVER_PORT = 19450;
const MOCK_PORT = 19460;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/v1`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectations = [];
let passed = 0;
const expect = (name, ok, detail = "") => {
    expectations.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
    if (ok) passed++;
};

// ---- mock upstream provider ----

const mockState = {
    videoCounter: 0,
    videos: new Map(), // id → { progress, status, prompt }
};

const mock = createServer(async (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    await new Promise((r) => req.on("end", r));

    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
    const send = (status, payload, ct = "application/json") => {
        res.writeHead(status, { "Content-Type": ct });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };

    // GET /v1/models — discovery
    if (url.pathname === "/v1/models" && req.method === "GET") {
        return send(200, {
            data: [
                { id: "dall-e-3", object: "model" },
                { id: "tts-1", object: "model" },
                { id: "whisper-1", object: "model" },
                { id: "sora-2", object: "model" },
            ],
        });
    }

    // POST /v1/images/generations — return both url + b64
    if (url.pathname === "/v1/images/generations" && req.method === "POST") {
        const j = JSON.parse(body || "{}");
        const png1x1 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        return send(200, {
            created: 1,
            data: Array.from({ length: j.n ?? 1 }).map(() => ({ b64_json: png1x1 })),
        });
    }

    // POST /v1/audio/speech — return binary "mp3"
    if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(Buffer.from([0x49, 0x44, 0x33, 0x04]));
        return;
    }

    // POST /v1/audio/transcriptions — multipart in, json out
    if (url.pathname === "/v1/audio/transcriptions" && req.method === "POST") {
        const ct = req.headers["content-type"] ?? "";
        if (!ct.startsWith("multipart/form-data")) {
            return send(400, { error: { message: "expected multipart" } });
        }
        return send(200, { text: "mock transcription", language: "en", duration: 1.2 });
    }

    // POST /v1/videos — multipart create
    if (url.pathname === "/v1/videos" && req.method === "POST") {
        const ct = req.headers["content-type"] ?? "";
        if (!ct.startsWith("multipart/form-data")) {
            return send(400, { error: { message: "expected multipart" } });
        }
        const id = `vid_${++mockState.videoCounter}`;
        mockState.videos.set(id, { progress: 0, status: "queued", prompt: "mock" });
        return send(200, {
            id,
            object: "video",
            status: "queued",
            model: "sora-2",
            seconds: "4",
            size: "720x1280",
            progress: 0,
            created_at: Math.floor(Date.now() / 1000),
        });
    }

    // GET /v1/videos/{id} — poll
    const videoGet = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
    if (videoGet && req.method === "GET") {
        const id = videoGet[1];
        const v = mockState.videos.get(id);
        if (!v) return send(404, { error: { message: "no such video" } });
        // Auto-advance for tests
        v.progress = Math.min(100, v.progress + 50);
        v.status = v.progress >= 100 ? "completed" : "in_progress";
        return send(200, {
            id,
            object: "video",
            status: v.status,
            progress: v.progress,
            model: "sora-2",
            seconds: "4",
            size: "720x1280",
            created_at: 1,
        });
    }

    // DELETE /v1/videos/{id}
    if (videoGet && req.method === "DELETE") {
        const id = videoGet[1];
        const existed = mockState.videos.delete(id);
        return send(200, { id, deleted: existed, object: "video.deleted" });
    }

    // GET /v1/videos/{id}/content
    const contentGet = url.pathname.match(/^\/v1\/videos\/([^/]+)\/content$/);
    if (contentGet && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "4" });
        res.end(Buffer.from([0x00, 0x00, 0x00, 0x18]));
        return;
    }

    return send(404, { error: { message: `mock: no route ${req.method} ${url.pathname}` } });
});

await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
console.log(`mock upstream listening on :${MOCK_PORT}`);

// ---- temp config ----
const tmp = mkdtempSync(path.join(tmpdir(), "loom-e2e-modalities-"));
mkdirSync(path.join(tmp, ".config"), { recursive: true });
const MASTER_KEY = randomBytes(32).toString("hex");
const config = `
master_key: ${MASTER_KEY}
admin:
  username: admin
  password: adminpass
providers:
  - name: mock
    type: openai
    base_url: ${MOCK_BASE}
    api_key: sk-mock
`;
writeFileSync(path.join(tmp, ".config", "loom.yaml"), config);

// ---- spawn server ----
const server = spawn("bun", ["run", "next", "start", "-p", String(SERVER_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, LOOM_USER_CWD: tmp },
    stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
const logs = [];
server.stdout.on("data", (d) => {
    const t = d.toString();
    logs.push(t);
    if (t.includes("Ready") || t.includes("Local:")) ready = true;
});
server.stderr.on("data", (d) => logs.push(d.toString()));

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
    mock.close();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
};

try {
    if (!ready) {
        console.error("server failed to start\n" + logs.join(""));
        throw new Error("no server");
    }

    // login
    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: "admin", user_password: "adminpass" }),
    });
    const cookie = loginRes.headers.getSetCookie?.()?.find((c) => c.startsWith("loom_session="))?.split(";")[0];
    expect("login succeeded", loginRes.ok && !!cookie);

    // ---- image generation ----
    const imgRes = await fetch(`${BASE}/api/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ model: "dall-e-3", prompt: "a cat", n: 2 }),
    });
    const imgJson = await imgRes.json();
    expect("image: 200 ok", imgRes.ok);
    expect("image: returned 2 entries", Array.isArray(imgJson.data) && imgJson.data.length === 2);
    expect("image: gateway response keeps b64_json", !!imgJson.data?.[0]?.b64_json);
    expect("image: gateway response has NO loom_artifact flag", !imgJson.data?.[0]?.loom_artifact);

    // ---- image artifact persistence ----
    // Find the corresponding log row, then verify:
    //   - log.generation.data[*].b64_json is stripped (artifact rewritten)
    //   - log.generation.data[*].url points at our artifact route
    //   - the artifact route serves the persisted binary
    const imgLogsRes = await fetch(
        `${BASE}/api/logs/generations?page=1&page_size=5&capability=image`,
        { headers: { Cookie: cookie } },
    );
    const imgLogs = await imgLogsRes.json();
    const imgLogId = imgLogs?.data?.items?.[0]?.id;
    expect("image-artifact: log row exists", typeof imgLogId === "string" && !!imgLogId);

    const imgLogDetail = await (
        await fetch(`${BASE}/api/logs/generations/${imgLogId}`, { headers: { Cookie: cookie } })
    ).json();
    const logData = imgLogDetail?.data?.generation?.data;
    expect("image-artifact: log generation.data is array", Array.isArray(logData) && logData.length === 2);
    expect("image-artifact: b64_json stripped from log", logData?.every((d) => d.b64_json == null));
    expect("image-artifact: loom_artifact flag set", logData?.every((d) => d.loom_artifact === true));
    expect(
        "image-artifact: url points at artifact route",
        logData?.[0]?.url === `/api/logs/generations/${imgLogId}/images/0`,
    );
    expect(
        "image-artifact: loom_artifacts summary present",
        Array.isArray(imgLogDetail?.data?.generation?.loom_artifacts)
            && imgLogDetail.data.generation.loom_artifacts.length === 2,
    );

    // Fetch the persisted binary and verify it matches the PNG header
    const artRes = await fetch(`${BASE}/api/logs/generations/${imgLogId}/images/0`, {
        headers: { Cookie: cookie },
    });
    const artBuf = new Uint8Array(await artRes.arrayBuffer());
    expect("image-artifact: artifact 200 ok", artRes.ok);
    expect("image-artifact: content-type is image/png", artRes.headers.get("Content-Type") === "image/png");
    expect(
        "image-artifact: bytes are a real PNG (\\x89PNG)",
        artBuf[0] === 0x89 && artBuf[1] === 0x50 && artBuf[2] === 0x4e && artBuf[3] === 0x47,
    );

    // Out-of-range index returns 404 from notFound()
    const art404 = await fetch(`${BASE}/api/logs/generations/${imgLogId}/images/99`, {
        headers: { Cookie: cookie },
    });
    expect("image-artifact: missing idx returns error envelope", art404.status === 400 || art404.status === 404);

    // ---- lazy migration of legacy logs (b64 written directly into DB) ----
    // Simulate a pre-feature row by writing a synthetic log via better-sqlite3,
    // then assert that the first GET strips it and persists an artifact.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(`${tmp}/data/loom.db`);
    const legacyId = `legacy-${Date.now()}`;
    const tinyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        "base64",
    ).toString("base64");
    const legacyGen = JSON.stringify({
        created: 1,
        data: [{ b64_json: tinyPng }],
    });
    const userId = db.prepare("SELECT id FROM users LIMIT 1").get().id;
    db.prepare(
        `INSERT INTO generation_logs (id, user_id, model_name, capability, status, generation, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(legacyId, userId, "gpt-image-1", "image", "completed", legacyGen);
    db.close();

    const legacyGet1 = await (
        await fetch(`${BASE}/api/logs/generations/${legacyId}`, { headers: { Cookie: cookie } })
    ).json();
    const legacyData = legacyGet1?.data?.generation?.data;
    expect(
        "legacy: GET strips b64_json on first read",
        legacyData?.[0]?.b64_json == null,
    );
    expect(
        "legacy: GET sets loom_artifact url",
        legacyData?.[0]?.url === `/api/logs/generations/${legacyId}/images/0`,
    );

    // Artifact should be served
    const legacyArt = await fetch(`${BASE}/api/logs/generations/${legacyId}/images/0`, {
        headers: { Cookie: cookie },
    });
    const legacyArtBuf = new Uint8Array(await legacyArt.arrayBuffer());
    expect("legacy: artifact served as png", legacyArt.ok && legacyArtBuf[0] === 0x89);

    // DB row should now have small generation (no b64)
    const db2 = new Database(`${tmp}/data/loom.db`);
    const persisted = db2.prepare("SELECT length(generation) as sz FROM generation_logs WHERE id=?").get(legacyId);
    db2.close();
    expect("legacy: DB row size shrunk after migration", persisted.sz < 1000);


    // ---- audio.speech (binary) ----
    const ttsRes = await fetch(`${BASE}/api/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ model: "tts-1", input: "hi", voice: "alloy" }),
    });
    const ttsBuf = await ttsRes.arrayBuffer();
    expect("tts: 200 ok", ttsRes.ok);
    expect("tts: content-type is audio/mpeg", ttsRes.headers.get("Content-Type") === "audio/mpeg");
    expect("tts: body is non-empty binary", ttsBuf.byteLength > 0);

    // ---- audio.transcription (multipart) ----
    const fd1 = new FormData();
    fd1.append("model", "whisper-1");
    fd1.append("file", new Blob([Buffer.from([0x00, 0x01, 0x02])], { type: "audio/wav" }), "sample.wav");
    fd1.append("response_format", "json");
    const trRes = await fetch(`${BASE}/api/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: fd1,
    });
    const trJson = await trRes.json();
    expect("transcribe: 200 ok", trRes.ok);
    expect("transcribe: text is from mock", trJson.text === "mock transcription");

    // Reject plain JSON to confirm multipart-only contract
    const trJsonReject = await fetch(`${BASE}/api/v1/audio/transcriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ model: "whisper-1" }),
    });
    expect("transcribe: rejects JSON content-type", trJsonReject.status === 400);

    // ---- video: create + poll + content + delete ----
    const fd2 = new FormData();
    fd2.append("model", "sora-2");
    fd2.append("prompt", "a duck");
    fd2.append("seconds", "4");
    fd2.append("size", "720x1280");
    const vidCreate = await fetch(`${BASE}/api/v1/videos`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: fd2,
    });
    const vidCreateJson = await vidCreate.json();
    expect("video.create: 200 ok", vidCreate.ok);
    expect("video.create: has id", typeof vidCreateJson.id === "string" && vidCreateJson.id.startsWith("vid_"));

    // Poll twice — mock advances 50% per call.
    const id = vidCreateJson.id;
    const poll1 = await fetch(`${BASE}/api/v1/videos/${id}?model=sora-2`, { headers: { Cookie: cookie } });
    const poll1Json = await poll1.json();
    expect("video.poll: 200 ok", poll1.ok);
    expect("video.poll: progress advances", poll1Json.progress === 50);
    const poll2 = await fetch(`${BASE}/api/v1/videos/${id}?model=sora-2`, { headers: { Cookie: cookie } });
    const poll2Json = await poll2.json();
    expect("video.poll: status becomes completed", poll2Json.status === "completed");

    // Poll requires `model` param
    const pollNoModel = await fetch(`${BASE}/api/v1/videos/${id}`, { headers: { Cookie: cookie } });
    expect("video.poll: requires model query param", pollNoModel.status === 400);

    // Content download (binary passthrough)
    const contentRes = await fetch(
        `${BASE}/api/v1/videos/${id}/content?model=sora-2&variant=video`,
        { headers: { Cookie: cookie } },
    );
    const contentBuf = await contentRes.arrayBuffer();
    expect("video.content: 200 ok", contentRes.ok);
    expect("video.content: video/mp4", contentRes.headers.get("Content-Type") === "video/mp4");
    expect("video.content: body present", contentBuf.byteLength === 4);

    // Delete
    const del = await fetch(`${BASE}/api/v1/videos/${id}?model=sora-2`, {
        method: "DELETE",
        headers: { Cookie: cookie },
    });
    expect("video.delete: 200 ok", del.ok);

    // Generation logs were written for at least the 4 generation calls
    const logsRes = await fetch(`${BASE}/api/logs/generations?page=1&page_size=20`, {
        headers: { Cookie: cookie },
    });
    const logsJson = await logsRes.json();
    const rows = logsJson?.data?.items ?? logsJson?.data ?? [];
    const capabilities = new Set(rows.map((r) => r.capability));
    expect("logs: contains image capability", capabilities.has("image"));
    expect("logs: contains audio.speech capability", capabilities.has("audio.speech"));
    expect("logs: contains audio.transcription capability", capabilities.has("audio.transcription"));
    expect("logs: contains video capability", capabilities.has("video"));
} catch (err) {
    console.error("Test threw:", err);
    console.error("\nserver logs (tail):");
    console.error(logs.slice(-30).join(""));
} finally {
    cleanup();
}

console.log(`\n${passed}/${expectations.length} expectations passed`);
process.exit(passed === expectations.length ? 0 : 1);
