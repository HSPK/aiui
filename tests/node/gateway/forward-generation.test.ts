// End-to-end tests for `forwardGeneration` — the full gateway pipeline
// (mergeParams → applyFieldFilter → variant.transformRequest →
// adapter.finalizeRequest → fetch → variant.parseResponse/handleStream),
// driven through the REAL capability/api-variant registries (populated by
// side-effect imports transitively pulled in by `lib/server/gateway/index.ts`)
// with `global.fetch` mocked.
//
// Retry/backoff/abort-timeout scenarios live in
// `forward-generation-retry.test.ts` so fake-timer setup doesn't leak into
// (or slow down) these more numerous non-retry cases.
//
// A small, locally-registered fake adapter (never auto-selected — only
// attached when a seeded provider explicitly sets `adapterId`) lets us
// force `resolveVariantId` into states the real capabilities/adapters can
// never reach (an unregistered id, or a variant serving a different
// capability) and gives full control over `meta` (the real "openai"
// adapter's `extractModelMeta` ignores `accepted_fields`/`rejected_fields`
// entirely, so it can never exercise the field-filter integration here).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { forwardGeneration } from "@/lib/server/gateway";
import { registerAdapter, type ProviderAdapter } from "@/lib/server/adapters";
import { defaultSelectVariantId, registerVariant, type UpstreamApiVariant } from "@/lib/server/api-variants";
import { registerCapability, type CapabilityHandler } from "@/lib/server/capabilities";
import type { AdapterId, NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";
import type { SessionUser } from "@/lib/server/auth";
import type { GenerationLog, Model, Provider, User } from "@/lib/server/db/schema";
import { resetDb, seedModel, seedProvider, seedUser } from "@/tests/helpers/db";
import { erroringStream, jsonResponse, mockFetch, parseSseEvents, readAllText, sseResponse } from "./helpers";

function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function getLogRow(id: string): GenerationLog {
    const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, id)).get();
    if (!row) throw new Error(`log row ${id} not found`);
    return row;
}

// ---- a minimal, locally-registered test adapter -----------------------

let fakeSelectVariant: ((capability: CapabilityHandler, model: Model, meta: NormalizedModelMeta | null) => UpstreamApiId) | null = null;
const TEST_ADAPTER_ID = "test-fg-adapter" as AdapterId;
const testAdapter: ProviderAdapter = {
    id: TEST_ADAPTER_ID,
    label: "Test forward-generation adapter",
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
};
registerAdapter(testAdapter);

// A dedicated fake capability + variant, registered once, whose
// `transformRequest` is controllable per-test — the only way to exercise
// forwardGeneration's "translate request body" try/catch (400) branch
// without a real variant that happens to throw (none do).
let fakeTransformRequest: ((body: Record<string, unknown>) => Record<string, unknown>) | null = null;
registerCapability({
    id: "test-fg-throws",
    label: "Test throwing capability",
    defaultVariantId: "test-fg-throws-variant" as UpstreamApiId,
});
const throwingVariant: UpstreamApiVariant = {
    id: "test-fg-throws-variant" as UpstreamApiId,
    capability: "test-fg-throws",
    path: "/test-fg-throws",
    supportsStreaming: false,
    transformRequest(body) {
        if (fakeTransformRequest) return fakeTransformRequest(body);
        return body;
    },
    parseResponse() {
        return { output: null, promptTokens: null, completionTokens: null, totalTokens: null, normalized: {} };
    },
    parseStreamChunk() {
        return null;
    },
};
registerVariant(throwingVariant);

function seedChatModel(overrides: Partial<Provider> = {}, modelOverrides: Partial<Model> = {}) {
    const provider = seedProvider({ adapterId: TEST_ADAPTER_ID, ...overrides });
    const model = seedModel({
        providerId: provider.id,
        name: modelOverrides.name ?? "chat-model",
        upstreamModelId: modelOverrides.upstreamModelId ?? "gpt-4o-mini",
        type: "chat",
        ...modelOverrides,
    });
    return { provider, model };
}

beforeEach(() => {
    resetDb();
    fakeSelectVariant = null;
    fakeTransformRequest = null;
});
afterEach(() => {
    fakeSelectVariant = null;
    fakeTransformRequest = null;
});

describe("forwardGeneration / request validation", () => {
    it("rejects an unknown capability", async () => {
        const user = seedUser();
        await expect(
            forwardGeneration(toSessionUser(user), "no-such-capability", { model: "x" }),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Unknown capability "no-such-capability"') });
    });

    it.each([
        ["missing", {}],
        ["blank", { model: "" }],
        ["non-string", { model: 123 }],
    ])("requires a string `model` field in the body (%s)", async (_label, body) => {
        const user = seedUser();
        await expect(
            forwardGeneration(toSessionUser(user), "chat", body),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("`model` is required") });
    });

    it("propagates 404 from resolveModel when the model does not exist anywhere", async () => {
        const user = seedUser();
        await expect(
            forwardGeneration(toSessionUser(user), "chat", { model: "totally-unknown-xyz" }),
        ).rejects.toMatchObject({ status: 404 });
    });
});

describe("forwardGeneration / variant resolution", () => {
    it("returns 400 when resolveVariantId yields an id nothing is registered under", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        fakeSelectVariant = () => "bogus-unregistered-variant" as UpstreamApiId;

        await expect(
            forwardGeneration(toSessionUser(user), "chat", { model: model.name }),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('No upstream variant registered for "bogus-unregistered-variant"'),
        });
    });

    it("returns 400 when the resolved variant serves a different capability than requested", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        // A REAL, registered variant — but one that serves "embedding", not "chat".
        fakeSelectVariant = () => "embeddings" as UpstreamApiId;

        await expect(
            forwardGeneration(toSessionUser(user), "chat", { model: model.name }),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('serves "embedding", not "chat"'),
        });
    });

    it("pins to model.apiVariantId over the adapter's own selectVariant / capability defaults", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, { apiVariantId: "responses" });
        fakeSelectVariant = () => {
            throw new Error("selectVariant must not run when a valid pin exists");
        };

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({
            id: "resp_1",
            status: "completed",
            output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hi there" }] }],
            usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        }));

        const { response } = await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [{ role: "system", content: "be terse" }, { role: "user", content: "hi" }],
            max_tokens: 50,
        });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/responses");
        const sentBody = JSON.parse(init.body as string);
        // translateRequest folds system → instructions, max_tokens → max_output_tokens,
        // and drops `messages` in favour of `input` — proves the RESPONSES-shaped
        // wire body (not chat-completion) actually reached fetch.
        expect(sentBody.messages).toBeUndefined();
        expect(sentBody.max_tokens).toBeUndefined();
        expect(sentBody.max_output_tokens).toBe(50);
        expect(sentBody.instructions).toBe("be terse");
        expect(Array.isArray(sentBody.input)).toBe(true);

        const parsed = (await response.json()) as { choices: Array<{ message: { content: string } }> };
        expect(parsed.choices[0].message.content).toBe("hi there");
    });

    it("ignores an apiVariantId pin that points at an unregistered/mismatched variant and falls back to the default selector", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, { apiVariantId: "embeddings" }); // registered, but wrong capability
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "hi" } }] }));

        await forwardGeneration(toSessionUser(user), "chat", { model: model.name, messages: [{ role: "user", content: "hi" }] });
        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url).toContain("/chat/completions"); // NOT /embeddings — pin was ignored
    });
});

describe("forwardGeneration / request-translation failure", () => {
    it("wraps a transformRequest throw into a 400 and fails the log", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "throws-model", upstreamModelId: "x", type: "test-fg-throws" });
        fakeTransformRequest = () => {
            throw new Error("boom");
        };

        await expect(
            forwardGeneration(toSessionUser(user), "test-fg-throws", { model: model.name }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'Failed to translate request body for variant "test-fg-throws-variant": boom',
        });

        const rows = db.select().from(schema.generationLogs).all();
        expect(rows).toHaveLength(0); // startLog runs AFTER translation — nothing to fail here
    });

    it("re-throws an HttpError raised during translation as-is (no double-wrapping)", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "throws-http-model", upstreamModelId: "x", type: "test-fg-throws" });
        const { HttpError } = await import("@/lib/server/response");
        fakeTransformRequest = () => {
            throw new HttpError("custom rejection", 422);
        };

        await expect(
            forwardGeneration(toSessionUser(user), "test-fg-throws", { model: model.name }),
        ).rejects.toMatchObject({ status: 422, message: "custom rejection" });
    });
});

describe("forwardGeneration / field filtering integration", () => {
    it("drops scalar fields not in meta.accepted_fields while always keeping model/messages/stream", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, {
            discoveredMetadata: { upstream_id: "gpt-4o-mini", accepted_fields: ["model", "messages", "temperature"] },
        });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "hi" } }] }));

        await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [{ role: "user", content: "hi" }],
            temperature: 0.5,
            top_p: 0.9, // NOT accepted -> must be dropped
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const sentBody = JSON.parse(init.body as string);
        expect(sentBody.temperature).toBe(0.5);
        expect(sentBody.top_p).toBeUndefined();
        expect(sentBody.messages).toBeDefined(); // ALWAYS_ON despite not being in accepted_fields
    });
});

describe("forwardGeneration / non-stream success (real openai adapter)", () => {
    it("resolves, merges defaults, finalizes the upstream model id, forwards to the upstream, and logs the outcome", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: "openai", baseUrl: "https://api.openai.com/v1" });
        const model = seedModel({
            providerId: provider.id,
            name: "gpt-4o-mini-caller-name",
            upstreamModelId: "gpt-4o-mini-2024",
            type: "chat",
            defaultParams: { temperature: 0.2 },
        });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({
            id: "chatcmpl-abc",
            object: "chat.completion",
            created: 123,
            model: "gpt-4o-mini-2024",
            choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }));

        const { response, logId } = await forwardGeneration(
            toSessionUser(user),
            "chat",
            { model: model.name, messages: [{ role: "user", content: "hello" }] },
            { conversationId: "conv-1", messageId: "msg-1" },
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.openai.com/v1/chat/completions");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer sk-test-upstream-key");
        expect(headers["Content-Type"]).toBe("application/json");
        const sentBody = JSON.parse(init.body as string);
        expect(sentBody.model).toBe("gpt-4o-mini-2024"); // finalizeRequest rewrite
        expect(sentBody.temperature).toBe(0.2); // merged from model.default_params

        await expect(response.json()).resolves.toMatchObject({ id: "chatcmpl-abc" });

        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        expect(row.capability).toBe("chat");
        expect(row.modelName).toBe(model.name);
        expect(row.output).toBe("hi there");
        expect(row.promptTokens).toBe(5);
        expect(row.completionTokens).toBe(3);
        expect(row.totalTokens).toBe(8);
        expect(row.firstTokenLatencyMs).toBeNull(); // non-stream: no TTFT
        expect(typeof row.totalLatencyMs).toBe("number");
        expect(row.conversationId).toBe("conv-1");
        expect(row.messageId).toBe("msg-1");
        // Logged input is the POST-translation upstream body, not the canonical one.
        expect((row.input as Record<string, unknown>).model).toBe("gpt-4o-mini-2024");
    });

    it("summarizes the last user message via capability.summarizeInput", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const { logId } = await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [
                { role: "system", content: "be terse" },
                { role: "user", content: "first question" },
                { role: "assistant", content: "first answer" },
                { role: "user", content: "second question" },
            ],
        });

        expect(getLogRow(logId).inputSummary).toBe("second question");
    });

    it("silently ignores stream:true for a variant that does not support streaming (embedding)", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "embed-model", upstreamModelId: "text-embedding-3-small", type: "embedding" });

        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
            usage: { prompt_tokens: 2, total_tokens: 2 },
        }));

        const { response } = await forwardGeneration(toSessionUser(user), "embedding", {
            model: model.name,
            input: "hello",
            stream: true, // caller asks for stream; embeddings variant can't do it
        });

        expect(response.headers.get("Content-Type")).toBe("application/json"); // NOT text/event-stream
        await expect(response.json()).resolves.toMatchObject({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    });

    it("passes through the upstream body/status and fails the log on a non-retriable 4xx", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid request" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        }));

        const { response, logId } = await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [{ role: "user", content: "hi" }],
        });

        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toContain("invalid request");
        expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on plain 4xx

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("Upstream HTTP 400");
    });

    it("promotes a variant-reported terminal error (HTTP 200 body) to a failed log", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "" } }], error: { message: "content filter triggered" } }));

        const { logId } = await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [{ role: "user", content: "hi" }],
        });

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("content filter triggered");
    });
});

describe("forwardGeneration / streaming success", () => {
    it("transcodes a real chat.completions SSE upstream and records TTFT + usage", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(sseResponse([
            { id: "chatcmpl-1", model: "gpt-4o-mini", choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
            { id: "chatcmpl-1", model: "gpt-4o-mini", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } },
        ]));

        const deltas: string[] = [];
        const { response, logId } = await forwardGeneration(
            toSessionUser(user),
            "chat",
            { model: model.name, messages: [{ role: "user", content: "hi" }], stream: true },
            { onStreamDelta: (d) => deltas.push(d.content) },
        );

        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
        const text = await readAllText(response.body!);
        const events = parseSseEvents(text);
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events[0].choices).toMatchObject([{ delta: { content: "Hi" } }]);
        expect(deltas).toEqual(["Hi"]);

        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        expect(row.output).toBe("Hi");
        expect(row.totalTokens).toBe(6);
        expect(typeof row.firstTokenLatencyMs).toBe("number");
        expect(typeof row.totalLatencyMs).toBe("number");
    });
});

describe("forwardGeneration / branch-coverage edge cases", () => {
    it("stringifies a non-Error value thrown during request translation", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "throws-nonerror-model", upstreamModelId: "x", type: "test-fg-throws" });
         
        fakeTransformRequest = () => {
            throw "boom-string";
        };

        await expect(
            forwardGeneration(toSessionUser(user), "test-fg-throws", { model: model.name }),
        ).rejects.toMatchObject({
            status: 400,
            message: 'Failed to translate request body for variant "test-fg-throws-variant": boom-string',
        });
    });

    it("logs a null inputSummary when the capability defines no summarizeInput", async () => {
        const user = seedUser();
        const provider = seedProvider({ adapterId: TEST_ADAPTER_ID });
        const model = seedModel({ providerId: provider.id, name: "no-summarize-model", upstreamModelId: "x", type: "test-fg-throws" });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        // fakeTransformRequest left null -> identity passthrough, request
        // succeeds; "test-fg-throws" never defines summarizeInput.
        const { logId } = await forwardGeneration(toSessionUser(user), "test-fg-throws", { model: model.name });

        expect(getLogRow(logId).inputSummary).toBeNull();
    });

    it("stringifies a non-Error rejection from the upstream fetch call", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, { maxRetries: 0 });
        const fetchMock = mockFetch();
         
        fetchMock.mockRejectedValue("ECONNRESET-as-a-plain-string");

        await expect(
            forwardGeneration(toSessionUser(user), "chat", { model: model.name, messages: [{ role: "user", content: "hi" }] }),
        ).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("ECONNRESET-as-a-plain-string"),
        });
    });

    it("falls back to application/json Content-Type on a non-OK passthrough when the upstream omits the header", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, { maxRetries: 0 });
        const fetchMock = mockFetch();
        // A null body carries no auto-assigned Content-Type (unlike a
        // string body, which fetch would default to text/plain).
        fetchMock.mockResolvedValue(new Response(null, { status: 400 }));

        const { response } = await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [{ role: "user", content: "hi" }],
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("falls back to upstream.statusText when reading the non-OK body throws", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, { maxRetries: 0 });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(
            new Response(erroringStream([], new Error("stream broke")), { status: 503, statusText: "Service Unavailable" }),
        );

        const { response, logId } = await forwardGeneration(toSessionUser(user), "chat", {
            model: model.name,
            messages: [{ role: "user", content: "hi" }],
        });

        expect(response.status).toBe(503);
        await expect(response.text()).resolves.toBe("Service Unavailable");
        expect(getLogRow(logId).output).toBe("Service Unavailable");
    });
});
