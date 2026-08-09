import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/auth")>();
    return {
        ...actual,
        getCurrentUser: vi.fn(),
        requireUser: vi.fn(),
        requireAdmin: vi.fn(),
        authenticateGateway: vi.fn(),
    };
});

vi.mock("@/lib/server/gateway", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/gateway")>();
    return {
        ...actual,
        forwardGeneration: vi.fn(),
        forwardMultipartGeneration: vi.fn(),
        gatewayProxy: vi.fn(),
    };
});

import { POST as chatPOST } from "@/app/api/v1/chat/completions/route";
import { POST as embeddingsPOST } from "@/app/api/v1/embeddings/route";
import { POST as imagesPOST } from "@/app/api/v1/images/generations/route";
import { POST as rerankPOST } from "@/app/api/v1/rerank/route";
import { POST as speechPOST } from "@/app/api/v1/audio/speech/route";
import { POST as transcriptionsPOST } from "@/app/api/v1/audio/transcriptions/route";
import { POST as videosPOST } from "@/app/api/v1/videos/route";
import { GET as videoGET, DELETE as videoDELETE } from "@/app/api/v1/videos/[id]/route";
import { GET as videoContentGET } from "@/app/api/v1/videos/[id]/content/route";
import { GET as modelsGET } from "@/app/api/v1/models/route";
import { forwardGeneration, forwardMultipartGeneration, gatewayProxy } from "@/lib/server/gateway";
import { resetDb, seedModel, seedProvider, seedUser } from "../../helpers/db";
import { asAnon, asUser, ctx, getReq, makeRequest, mockDiscoveryFetch, toSessionUser } from "./_helpers";

const mockForwardGeneration = vi.mocked(forwardGeneration);
const mockForwardMultipart = vi.mocked(forwardMultipartGeneration);
const mockGatewayProxy = vi.mocked(gatewayProxy);

function okResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

/** Table of the simple (non-multipart) forwardGeneration-backed routes. */
const SIMPLE_ROUTES: { name: string; path: string; capability: string; handler: typeof chatPOST }[] = [
    { name: "chat/completions", path: "/api/v1/chat/completions", capability: "chat", handler: chatPOST },
    { name: "embeddings", path: "/api/v1/embeddings", capability: "embedding", handler: embeddingsPOST },
    { name: "images/generations", path: "/api/v1/images/generations", capability: "image", handler: imagesPOST },
    { name: "rerank", path: "/api/v1/rerank", capability: "rerank", handler: rerankPOST },
    { name: "audio/speech", path: "/api/v1/audio/speech", capability: "audio.speech", handler: speechPOST },
];

describe.each(SIMPLE_ROUTES)("POST $path (gateway)", ({ path, capability, handler }) => {
    beforeEach(() => {
        resetDb();
        mockForwardGeneration.mockReset();
    });

    it("401s an unauthenticated (missing/invalid key) caller", async () => {
        asAnon();
        const res = await handler(makeRequest(path, { method: "POST", json: { model: "gpt-4o" } }));
        expect(res.status).toBe(401);
        expect(mockForwardGeneration).not.toHaveBeenCalled();
    });

    it("400s a body missing `model`", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await handler(makeRequest(path, { method: "POST", json: { foo: "bar" } }));
        expect(res.status).toBe(400);
        expect(mockForwardGeneration).not.toHaveBeenCalled();
    });

    it(`forwards to forwardGeneration with capability "${capability}" and the parsed body, passing the upstream Response through verbatim`, async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const upstream = okResponse({ id: "gen-1", object: "ok" });
        mockForwardGeneration.mockResolvedValue({ response: upstream, logId: "log-1" });

        const res = await handler(
            makeRequest(path, { method: "POST", json: { model: "gpt-4o", input: "hello", extra_field: 1 } }),
        );

        expect(res).toBe(upstream);
        expect(mockForwardGeneration).toHaveBeenCalledTimes(1);
        const [calledUser, calledCapability, calledBody] = mockForwardGeneration.mock.calls[0];
        expect(calledUser.id).toBe(user.id);
        expect(calledCapability).toBe(capability);
        expect(calledBody).toMatchObject({ model: "gpt-4o", input: "hello", extra_field: 1 });
    });

    it("propagates a streaming Response untouched (passthrough)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("data: {\"chunk\":1}\n\n"));
                controller.close();
            },
        });
        const streamed = new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        });
        mockForwardGeneration.mockResolvedValue({ response: streamed, logId: "log-2" });

        const res = await handler(
            makeRequest(path, { method: "POST", json: { model: "gpt-4o", stream: true } }),
        );
        expect(res).toBe(streamed);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        const text = await res.text();
        expect(text).toContain("chunk");
    });

    it("propagates errors thrown by forwardGeneration (e.g. unknown model -> 404)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const { notFound } = await import("@/lib/server/response");
        mockForwardGeneration.mockRejectedValue(notFound(`Model "nope" not found`));
        const res = await handler(makeRequest(path, { method: "POST", json: { model: "nope" } }));
        expect(res.status).toBe(404);
    });
});

describe("POST /api/v1/audio/transcriptions (multipart)", () => {
    beforeEach(() => {
        resetDb();
        mockForwardMultipart.mockReset();
    });

    it("401s an unauthenticated caller", async () => {
        asAnon();
        const form = new FormData();
        form.set("model", "whisper-1");
        const res = await transcriptionsPOST(makeRequest("/api/v1/audio/transcriptions", { method: "POST", body: form }));
        expect(res.status).toBe(401);
    });

    it("400s a non-multipart body", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await transcriptionsPOST(
            makeRequest("/api/v1/audio/transcriptions", {
                method: "POST",
                json: { model: "whisper-1" },
            }),
        );
        expect(res.status).toBe(400);
        expect(mockForwardMultipart).not.toHaveBeenCalled();
    });

    it("400s a request with no Content-Type header at all (?? \"\" fallback)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await transcriptionsPOST(makeRequest("/api/v1/audio/transcriptions", { method: "POST" }));
        expect(res.status).toBe(400);
        expect(mockForwardMultipart).not.toHaveBeenCalled();
    });

    it("forwards the multipart form to forwardMultipartGeneration with capability audio.transcription", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const upstream = okResponse({ text: "hello world" });
        mockForwardMultipart.mockResolvedValue({ response: upstream, logId: "log-3" });

        const form = new FormData();
        form.set("model", "whisper-1");
        form.set("file", new File(["fake-audio-bytes"], "audio.mp3", { type: "audio/mpeg" }));
        const res = await transcriptionsPOST(
            makeRequest("/api/v1/audio/transcriptions", { method: "POST", body: form }),
        );

        expect(res).toBe(upstream);
        expect(mockForwardMultipart).toHaveBeenCalledTimes(1);
        const [calledUser, calledCapability, calledForm] = mockForwardMultipart.mock.calls[0];
        expect(calledUser.id).toBe(user.id);
        expect(calledCapability).toBe("audio.transcription");
        expect(calledForm.get("model")).toBe("whisper-1");
    });
});

describe("POST /api/v1/videos (multipart)", () => {
    beforeEach(() => {
        resetDb();
        mockForwardMultipart.mockReset();
    });

    it("401s an unauthenticated caller", async () => {
        asAnon();
        const form = new FormData();
        form.set("model", "sora-2");
        form.set("prompt", "a cat");
        const res = await videosPOST(makeRequest("/api/v1/videos", { method: "POST", body: form }));
        expect(res.status).toBe(401);
    });

    it("400s a non-multipart body", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await videosPOST(
            makeRequest("/api/v1/videos", { method: "POST", json: { model: "sora-2", prompt: "a cat" } }),
        );
        expect(res.status).toBe(400);
        expect(mockForwardMultipart).not.toHaveBeenCalled();
    });

    it("400s a request with no Content-Type header at all (?? \"\" fallback)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await videosPOST(makeRequest("/api/v1/videos", { method: "POST" }));
        expect(res.status).toBe(400);
        expect(mockForwardMultipart).not.toHaveBeenCalled();
    });

    it("forwards to forwardMultipartGeneration with capability video", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const upstream = okResponse({ id: "video-1", status: "queued" });
        mockForwardMultipart.mockResolvedValue({ response: upstream, logId: "log-4" });

        const form = new FormData();
        form.set("model", "sora-2");
        form.set("prompt", "a cat riding a bike");
        const res = await videosPOST(makeRequest("/api/v1/videos", { method: "POST", body: form }));

        expect(res).toBe(upstream);
        const [, calledCapability, calledForm] = mockForwardMultipart.mock.calls[0];
        expect(calledCapability).toBe("video");
        expect(calledForm.get("prompt")).toBe("a cat riding a bike");
    });
});

describe("GET/DELETE /api/v1/videos/[id] and /api/v1/videos/[id]/content", () => {
    beforeEach(() => {
        resetDb();
        mockGatewayProxy.mockReset();
    });

    it("401s an unauthenticated caller on all three", async () => {
        asAnon();
        expect(
            (await videoGET(getReq("/api/v1/videos/vid-1?model=sora-2"), ctx({ id: "vid-1" }))).status,
        ).toBe(401);
        expect(
            (await videoDELETE(getReq("/api/v1/videos/vid-1?model=sora-2"), ctx({ id: "vid-1" }))).status,
        ).toBe(401);
        expect(
            (await videoContentGET(getReq("/api/v1/videos/vid-1/content?model=sora-2"), ctx({ id: "vid-1" }))).status,
        ).toBe(401);
    });

    it("400s a missing `model` query param", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await videoGET(getReq("/api/v1/videos/vid-1"), ctx({ id: "vid-1" }));
        expect(res.status).toBe(400);
        expect(mockGatewayProxy).not.toHaveBeenCalled();
    });

    it("400s an invalid `variant` on the content endpoint", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await videoContentGET(
            getReq("/api/v1/videos/vid-1/content?model=sora-2&variant=bogus"),
            ctx({ id: "vid-1" }),
        );
        expect(res.status).toBe(400);
    });

    it("GET proxies to gatewayProxy with method GET and the encoded video path", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const upstream = okResponse({ id: "vid-1", status: "completed" });
        mockGatewayProxy.mockResolvedValue(upstream);
        const res = await videoGET(getReq("/api/v1/videos/vid-1?model=sora-2"), ctx({ id: "vid-1" }));
        expect(res).toBe(upstream);
        expect(mockGatewayProxy).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: "sora-2", method: "GET", path: "/videos/vid-1" }),
        );
    });

    it("DELETE proxies to gatewayProxy with method DELETE", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const upstream = okResponse({ deleted: true });
        mockGatewayProxy.mockResolvedValue(upstream);
        const res = await videoDELETE(getReq("/api/v1/videos/vid-1?model=sora-2"), ctx({ id: "vid-1" }));
        expect(res).toBe(upstream);
        expect(mockGatewayProxy).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: "sora-2", method: "DELETE", path: "/videos/vid-1" }),
        );
    });

    it("content GET forwards the variant query param and binary passthrough", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
        const upstream = new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
        mockGatewayProxy.mockResolvedValue(upstream);
        const res = await videoContentGET(
            getReq("/api/v1/videos/vid-1/content?model=sora-2&variant=thumbnail"),
            ctx({ id: "vid-1" }),
        );
        expect(res).toBe(upstream);
        expect(mockGatewayProxy).toHaveBeenCalledWith(
            expect.objectContaining({
                modelName: "sora-2",
                method: "GET",
                path: "/videos/vid-1/content",
                query: "variant=thumbnail",
            }),
        );
    });

    it("content GET omits the query when no variant is given", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        mockGatewayProxy.mockResolvedValue(okResponse({}));
        await videoContentGET(getReq("/api/v1/videos/vid-1/content?model=sora-2"), ctx({ id: "vid-1" }));
        expect(mockGatewayProxy).toHaveBeenCalledWith(expect.objectContaining({ query: undefined }));
    });
});

describe("GET /api/v1/models", () => {
    beforeEach(() => resetDb());

    it("401s an unauthenticated caller", async () => {
        asAnon();
        const res = await modelsGET(getReq("/api/v1/models"));
        expect(res.status).toBe(401);
    });

    it("lists DB-defined enabled models in the OpenAI list shape", async () => {
        mockDiscoveryFetch();
        const user = seedUser();
        asUser(toSessionUser(user));
        const provider = seedProvider({ enabled: false });
        seedModel({ providerId: provider.id, name: "my-chat-model", type: "chat" });
        seedModel({ providerId: provider.id, name: "disabled-model", type: "chat", enabled: false });

        const res = await modelsGET(getReq("/api/v1/models"));
        expect(res.status).toBe(200);
        const body = await res.json() as { object: string; data: { id: string; object: string; type: string }[] };
        expect(body.object).toBe("list");
        expect(body.data.map((m) => m.id)).toContain("my-chat-model");
        expect(body.data.map((m) => m.id)).not.toContain("disabled-model");
    });

    it("merges in live-discovered models, deduped against DB overrides by id", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const provider = seedProvider({ enabled: true });
        seedModel({ providerId: provider.id, name: "overridden-model", type: "chat" });

        global.fetch = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    data: [{ id: "overridden-model" }, { id: "discovered-only-model" }],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        const res = await modelsGET(getReq("/api/v1/models"));
        const body = await res.json() as { data: { id: string }[] };
        const ids = body.data.map((m) => m.id);
        // Only ONE entry for the id that exists in both DB + discovery.
        expect(ids.filter((id) => id === "overridden-model")).toHaveLength(1);
        expect(ids).toContain("discovered-only-model");
    });
});
