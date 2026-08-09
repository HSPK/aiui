// Tests for `forwardMultipartGeneration` + `gatewayProxy` — the
// multipart/form-data forwarder (audio.transcription, video create) and
// the generic follow-up resource proxy (poll/download/delete).
//
// Both call the REAL adapter/capability/variant registries (populated by
// side-effect imports transitively pulled in via `./index`). A small,
// locally-registered fake adapter (never auto-selected — only attached
// when a seeded provider explicitly sets `adapterId`) lets us:
//   - force `resolveVariantId` into states the real capabilities/adapters
//     can never produce (an unregistered variant id, or a variant that
//     serves a different capability), without touching production code;
//   - exercise `gatewayProxy`'s `resourceUrl`/`resourceHeaders` DEFAULT
//     fallback branches, since every currently-registered real adapter
//     defines both;
//   - prove the mergeParams → applyFieldFilter integration with a
//     controllable `extractModelMeta` (the real "openai" adapter's
//     extractModelMeta ignores `accepted_fields`/`rejected_fields`
//     entirely, so it can never exercise that branch here).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forwardMultipartGeneration, gatewayProxy } from "@/lib/server/gateway/multipart";
import { registerAdapter, type ProviderAdapter } from "@/lib/server/adapters";
import { defaultSelectVariantId } from "@/lib/server/api-variants";
import type { CapabilityHandler } from "@/lib/server/capabilities";
import type { AdapterId, NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";
import type { SessionUser } from "@/lib/server/auth";
import type { Model, Provider, User } from "@/lib/server/db/schema";
import { resetDb, seedModel, seedProvider, seedUser } from "@/tests/helpers/db";
import { erroringStream, jsonResponse, mockFetch } from "./helpers";

function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

// ---- a minimal, locally-registered test adapter -----------------------

let fakeSelectVariant: ((capability: CapabilityHandler, model: Model, meta: NormalizedModelMeta | null) => UpstreamApiId) | null = null;
const TEST_ADAPTER_ID = "test-multipart-adapter" as AdapterId;
const testAdapter: ProviderAdapter = {
    id: TEST_ADAPTER_ID,
    label: "Test multipart adapter",
    matches: () => false, // never auto-detected; only attached via explicit provider.adapterId
    fetchModels: async () => [],
    extractModelMeta: (raw) => raw as NormalizedModelMeta, // identity — full control over meta in tests
    selectVariant: (capability, model, meta) =>
        fakeSelectVariant ? fakeSelectVariant(capability, model, meta) : defaultSelectVariantId(capability, meta),
    upstreamUrl: (args) => `${args.provider.baseUrl.replace(/\/$/, "")}${args.variant.path}`,
    upstreamHeaders: (_args, apiKey) => ({
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    }),
    // Deliberately NO resourceUrl / resourceHeaders / finalizeRequest —
    // exercises gatewayProxy's own default-fallback arrow functions.
};
registerAdapter(testAdapter);

beforeEach(() => {
    resetDb();
    fakeSelectVariant = null;
});
afterEach(() => {
    fakeSelectVariant = null;
});

describe("forwardMultipartGeneration", () => {
    it("rejects an unknown capability before touching the model field", async () => {
        const user = seedUser();
        const form = new FormData();
        await expect(
            forwardMultipartGeneration(toSessionUser(user), "no-such-capability", form),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Unknown capability "no-such-capability"') });
    });

    it.each([
        ["missing entirely", new FormData()],
        ["blank string", (() => { const f = new FormData(); f.set("model", ""); return f; })()],
        ["a File instead of a string", (() => { const f = new FormData(); f.set("model", new File(["x"], "not-a-model-name")); return f; })()],
    ])("requires a non-empty string `model` form field (%s)", async (_label, form) => {
        const user = seedUser();
        await expect(
            forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("`model` form field is required") });
    });

    it("propagates 404 when the named model does not resolve to anything (real resolveModel)", async () => {
        const user = seedUser();
        const form = new FormData();
        form.set("model", "totally-unknown-model-xyz");
        await expect(
            forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form),
        ).rejects.toMatchObject({ status: 404 });
    });

    it("returns 400 when resolveVariantId yields an id nothing is registered under", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "chat-model-unreg", upstreamModelId: "gpt-4o-mini", type: "chat" });
        fakeSelectVariant = () => "bogus-unregistered-variant" as UpstreamApiId;

        const form = new FormData();
        form.set("model", model.name);
        await expect(
            forwardMultipartGeneration(toSessionUser(user), "chat", form),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('No upstream variant registered for "bogus-unregistered-variant"'),
        });
    });

    it("returns 400 when the resolved variant serves a different capability than requested", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "chat-model-mismatch", upstreamModelId: "gpt-4o-mini", type: "chat" });
        // A REAL, registered variant — but one that serves "audio.transcription", not "chat".
        fakeSelectVariant = () => "audio.transcriptions" as UpstreamApiId;

        const form = new FormData();
        form.set("model", model.name);
        await expect(
            forwardMultipartGeneration(toSessionUser(user), "chat", form),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('serves "audio.transcription", not "chat"'),
        });
    });

    it("merges model.default_params into scalars, filters via meta.accepted_fields, rewrites model to upstreamModelId, strips File entries from filtering, and drops the JSON content-type", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID, baseUrl: "https://upstream.example/v1" });
        const model = seedModel({
            providerId: provider.id,
            name: "whisper-caller-name",
            upstreamModelId: "whisper-upstream-id",
            type: "audio.transcription",
            defaultParams: { language: "en" },
            discoveredMetadata: { upstream_id: "whisper-upstream-id", accepted_fields: ["model", "language"] },
        });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ text: "hello world" }));

        const form = new FormData();
        form.set("model", model.name);
        form.set("temperature", "0.9"); // NOT in accepted_fields -> must be dropped
        form.set("file", new File([new Uint8Array([1, 2, 3])], "audio.wav", { type: "audio/wav" }));

        const { response } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);
        await expect(response.json()).resolves.toEqual({ text: "hello world" });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://upstream.example/v1/audio/transcriptions");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBeUndefined();
        expect(headers["content-type"]).toBeUndefined();
        expect(headers["Authorization"]).toBe("Bearer sk-test-upstream-key");

        const sentForm = init.body as FormData;
        expect(sentForm.get("model")).toBe("whisper-upstream-id"); // rewritten + ALWAYS_ON-preserved
        expect(sentForm.get("language")).toBe("en"); // merged from model.default_params, in accepted_fields
        expect(sentForm.get("temperature")).toBeNull(); // dropped: not in accepted_fields
        const sentFile = sentForm.get("file") as File;
        expect(sentFile.name).toBe("audio.wav"); // Files bypass merge/filter entirely
    });

    it("summarises the caller-facing prompt/file BEFORE the model field is rewritten, and redacts File fields in the persisted input", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-summary", upstreamModelId: "whisper-x", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ text: "ok" }));

        const form = new FormData();
        form.set("model", model.name);
        form.set("file", new File([new Uint8Array([9, 9])], "clip.mp3", { type: "audio/mpeg" }));

        const { logId } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);

        const { db, schema } = await import("@/lib/server/db");
        const { eq } = await import("drizzle-orm");
        const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, logId)).get()!;
        expect(row.inputSummary).toBe("audio file: clip.mp3 (2 bytes)");
        const input = row.input as Record<string, unknown>;
        expect(input.file).toEqual({ _kind: "file", name: "clip.mp3", type: "audio/mpeg", size: 2 });
        expect(input.model).toBe(model.name); // logged BEFORE the upstream-id rewrite
    });

    it("falls back to a generic 'audio input' summary when no prompt/file text is present", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-noprompt", upstreamModelId: "whisper-y", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ text: "ok" }));

        const form = new FormData();
        form.set("model", model.name);

        const { logId } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);
        const { db, schema } = await import("@/lib/server/db");
        const { eq } = await import("drizzle-orm");
        const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, logId)).get()!;
        expect(row.inputSummary).toBe("audio input");
    });

    it("truncates an oversized scalar field when redacting the persisted input", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-longfield", upstreamModelId: "whisper-z", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ text: "ok" }));

        const longValue = "hello world ".repeat(400);
        const form = new FormData();
        form.set("model", model.name);
        form.set("context", longValue);

        const { logId } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);
        const { db, schema } = await import("@/lib/server/db");
        const { eq } = await import("drizzle-orm");
        const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, logId)).get()!;
        const input = row.input as Record<string, unknown>;
        expect(input.context).toBe(`${longValue.slice(0, 4000)}…(+${longValue.length - 4000})`);
    });

    it("fails the log with 502 when the upstream fetch rejects (network error)", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-neterr", upstreamModelId: "whisper-neterr", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

        const form = new FormData();
        form.set("model", model.name);

        await expect(
            forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form),
        ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("ECONNREFUSED") });
    });

    it("logs failure and passes through the upstream body + status when the upstream response is non-OK", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-4xx", upstreamModelId: "whisper-4xx", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "bad file" }), {
            status: 415,
            headers: { "Content-Type": "application/json" },
        }));

        const form = new FormData();
        form.set("model", model.name);

        const { response } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);
        expect(response.status).toBe(415);
        await expect(response.text()).resolves.toContain("bad file");
    });

    it("falls back to upstream.statusText when reading a non-OK upstream body throws", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-503", upstreamModelId: "whisper-503", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(
            new Response(erroringStream([], new Error("stream broke")), { status: 503, statusText: "Service Unavailable" }),
        );

        const form = new FormData();
        form.set("model", model.name);

        const { response, logId } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);
        expect(response.status).toBe(503);
        await expect(response.text()).resolves.toBe("Service Unavailable");

        const { db, schema } = await import("@/lib/server/db");
        const { eq } = await import("drizzle-orm");
        const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, logId)).get()!;
        expect(row.output).toBe("Service Unavailable");
    });

    it("delegates a successful upstream JSON response to handleNonStream", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-ok", upstreamModelId: "whisper-ok", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ text: "the transcript" }));

        const form = new FormData();
        form.set("model", model.name);

        const { response } = await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        await expect(response.json()).resolves.toEqual({ text: "the transcript" });
    });

    it("aborts the upstream request immediately when the caller's signal is already aborted", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "whisper-abort", upstreamModelId: "whisper-abort", type: "audio.transcription" });

        const fetchMock = mockFetch();
        fetchMock.mockImplementation((_url: string, init: RequestInit) => {
            const signal = init.signal as AbortSignal;
            expect(signal.aborted).toBe(true);
            expect(signal.reason).toBe("client gone");
            return Promise.reject(new Error("aborted"));
        });

        const controller = new AbortController();
        controller.abort("client gone");

        const form = new FormData();
        form.set("model", model.name);

        await expect(
            forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form, { signal: controller.signal }),
        ).rejects.toMatchObject({ status: 502 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("wraps a mergeParams/applyFieldFilter crash into a 400 instead of a raw 500", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        // A discovered-metadata shape with a truthy-but-non-iterable
        // `accepted_fields.length` (e.g. hand-edited DB row, or a
        // provider's /models endpoint returning a malformed entry) makes
        // `new Set(meta.accepted_fields)` inside applyFieldFilter throw a
        // real TypeError — the only realistic way to reach
        // forwardMultipartGeneration's translation try/catch, since
        // mergeParams/applyFieldFilter never throw for any
        // JSON-representable body.
        const model = seedModel({
            providerId: provider.id,
            name: "whisper-badmeta",
            upstreamModelId: "whisper-badmeta",
            type: "audio.transcription",
            discoveredMetadata: { accepted_fields: { length: 5 } },
        });

        const form = new FormData();
        form.set("model", model.name);

        await expect(
            forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining("Failed to translate multipart body"),
        });
    });

    it("JSON-stringifies an object-valued merged scalar field (e.g. an array default_params entry) when rebuilding the upstream form", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({
            providerId: provider.id,
            name: "whisper-objfield",
            upstreamModelId: "whisper-objfield",
            type: "audio.transcription",
            defaultParams: { timestamp_granularities: ["word", "segment"] },
        });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ text: "ok" }));

        const form = new FormData();
        form.set("model", model.name);

        await forwardMultipartGeneration(toSessionUser(user), "audio.transcription", form);

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const sentForm = init.body as FormData;
        expect(sentForm.get("timestamp_granularities")).toBe(JSON.stringify(["word", "segment"]));
    });

    it("summariseForm falls back to a null inputSummary for a non-audio-transcription capability with no prompt field", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "chat-no-prompt", upstreamModelId: "gpt-4o-mini", type: "chat" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ id: "chatcmpl-1", choices: [{ message: { content: "hi" } }] }));

        const form = new FormData();
        form.set("model", model.name);

        const { logId } = await forwardMultipartGeneration(toSessionUser(user), "chat", form);
        const { db, schema } = await import("@/lib/server/db");
        const { eq } = await import("drizzle-orm");
        const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, logId)).get()!;
        expect(row.inputSummary).toBeNull();
    });
});

describe("gatewayProxy", () => {
    it("rejects when the resolved provider is disabled", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID, enabled: false });
        const model = seedModel({ providerId: provider.id, name: "proxy-disabled", upstreamModelId: "x" });

        await expect(
            gatewayProxy({ user: toSessionUser(user), modelName: model.name, path: "/videos/abc" }),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("is disabled") });
    });

    it("uses the DEFAULT resourceUrl/resourceHeaders fallback when the adapter defines neither, appending query and Authorization", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID, baseUrl: "https://upstream.example/v1" });
        const model = seedModel({ providerId: provider.id, name: "proxy-default", upstreamModelId: "x" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response("binary-body", {
            status: 200,
            headers: { "Content-Type": "video/mp4", "Content-Length": "11", "Content-Disposition": "attachment; filename=clip.mp4" },
        }));

        const res = await gatewayProxy({
            user: toSessionUser(user),
            modelName: model.name,
            path: "/videos/job-1/content",
            query: "api-version=1",
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://upstream.example/v1/videos/job-1/content?api-version=1");
        expect(init.method).toBe("GET");
        expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test-upstream-key");

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("video/mp4");
        expect(res.headers.get("Content-Length")).toBe("11");
        expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=clip.mp4");
        await expect(res.text()).resolves.toBe("binary-body");
    });

    it("omits the Authorization header from the default fallback when the provider has no api key", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID, apiKeyEncrypted: null });
        const model = seedModel({ providerId: provider.id, name: "proxy-nokey", upstreamModelId: "x" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await gatewayProxy({ user: toSessionUser(user), modelName: model.name, path: "/videos/job-2" });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    });

    it("defaults to application/octet-stream and omits optional headers when the upstream sends none", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "proxy-noheaders", upstreamModelId: "x" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

        const res = await gatewayProxy({ user: toSessionUser(user), modelName: model.name, path: "/videos/job-3" });
        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.has("Content-Length")).toBe(false);
        expect(res.headers.has("Content-Disposition")).toBe(false);
    });

    it("uses the caller-supplied method, body, and extra headers, forcing JSON content-type only for a non-FormData body", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "proxy-post", upstreamModelId: "x" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

        await gatewayProxy({
            user: toSessionUser(user),
            modelName: model.name,
            path: "/videos",
            method: "POST",
            body: JSON.stringify({ prompt: "a cat" }),
            headers: { "X-Extra": "1" },
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
        expect((init.headers as Record<string, string>)["X-Extra"]).toBe("1");
    });

    it("does not force a Content-Type when the body is FormData", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "proxy-form", upstreamModelId: "x" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

        const body = new FormData();
        body.set("a", "b");
        await gatewayProxy({ user: toSessionUser(user), modelName: model.name, path: "/videos", method: "POST", body });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    });

    it("composes the caller signal with the timeout signal, aborting immediately when the caller already disconnected", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "proxy-abort", upstreamModelId: "x" });

        const fetchMock = mockFetch();
        fetchMock.mockImplementation((_url: string, init: RequestInit) => {
            const signal = init.signal as AbortSignal;
            expect(signal.aborted).toBe(true);
            return Promise.reject(new Error("aborted"));
        });

        const controller = new AbortController();
        controller.abort("disconnect");

        await expect(
            gatewayProxy({ user: toSessionUser(user), modelName: model.name, path: "/videos/x", signal: controller.signal }),
        ).rejects.toThrow();
    });
});
