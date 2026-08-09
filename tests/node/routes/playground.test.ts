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

vi.mock("@/lib/server/playground", () => ({
    sendPlaygroundChat: vi.fn(),
    runEmbeddingComparison: vi.fn(),
}));

import { POST as chatPOST } from "@/app/api/playground/chat/route";
import { POST as embeddingPOST } from "@/app/api/playground/embedding/route";
import { sendPlaygroundChat, runEmbeddingComparison } from "@/lib/server/playground";
import { resetDb, seedUser } from "../../helpers/db";
import { asAnon, asUser, envelope, postJson, toSessionUser } from "./_helpers";

const mockSendChat = vi.mocked(sendPlaygroundChat);
const mockRunEmbedding = vi.mocked(runEmbeddingComparison);

describe("POST /api/playground/chat", () => {
    beforeEach(() => {
        resetDb();
        mockSendChat.mockReset();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await chatPOST(postJson("/api/playground/chat", { content: "hi", model: "gpt-4o" }));
        expect(res.status).toBe(401);
        expect(mockSendChat).not.toHaveBeenCalled();
    });

    it("400s a body missing model", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await chatPOST(postJson("/api/playground/chat", { content: "hi" }));
        expect(res.status).toBe(400);
    });

    it("400s a body missing content", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await chatPOST(postJson("/api/playground/chat", { model: "gpt-4o" }));
        expect(res.status).toBe(400);
    });

    it("400s an invalid conversation_id (not a uuid)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await chatPOST(
            postJson("/api/playground/chat", { content: "hi", model: "gpt-4o", conversation_id: "not-a-uuid" }),
        );
        expect(res.status).toBe(400);
    });

    it("passes the validated body + caller straight through to sendPlaygroundChat and returns its Response verbatim", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const upstream = new Response(JSON.stringify({ hello: "world" }), {
            status: 200,
            headers: { "content-type": "application/json", "x-conversation-id": "conv-1" },
        });
        mockSendChat.mockResolvedValue(upstream);

        const res = await chatPOST(
            postJson("/api/playground/chat", {
                content: "hello there",
                model: "gpt-4o",
                temperature: 0.5,
                stream: true,
            }),
        );

        expect(res).toBe(upstream);
        expect(res.headers.get("x-conversation-id")).toBe("conv-1");
        expect(mockSendChat).toHaveBeenCalledTimes(1);
        const [calledUser, calledBody] = mockSendChat.mock.calls[0];
        expect(calledUser.id).toBe(user.id);
        expect(calledBody).toMatchObject({ content: "hello there", model: "gpt-4o", temperature: 0.5, stream: true });
    });

    it("propagates errors thrown by sendPlaygroundChat (e.g. unknown model -> 404)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const { notFound } = await import("@/lib/server/response");
        mockSendChat.mockRejectedValue(notFound("Model not found"));

        const res = await chatPOST(postJson("/api/playground/chat", { content: "hi", model: "nonexistent" }));
        expect(res.status).toBe(404);
    });
});

describe("POST /api/playground/embedding", () => {
    beforeEach(() => {
        resetDb();
        mockRunEmbedding.mockReset();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await embeddingPOST(
            postJson("/api/playground/embedding", { models: ["m"], query: "q", documents: ["d"] }),
        );
        expect(res.status).toBe(401);
        expect(mockRunEmbedding).not.toHaveBeenCalled();
    });

    it("400s an empty models array", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await embeddingPOST(
            postJson("/api/playground/embedding", { models: [], query: "q", documents: ["d"] }),
        );
        expect(res.status).toBe(400);
    });

    it("400s an empty documents array", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await embeddingPOST(
            postJson("/api/playground/embedding", { models: ["m"], query: "q", documents: [] }),
        );
        expect(res.status).toBe(400);
    });

    it("400s a missing query", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await embeddingPOST(
            postJson("/api/playground/embedding", { models: ["m"], documents: ["d"] }),
        );
        expect(res.status).toBe(400);
    });

    it("400s more than 64 documents", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const documents = Array.from({ length: 65 }, (_, i) => `doc-${i}`);
        const res = await embeddingPOST(
            postJson("/api/playground/embedding", { models: ["m"], query: "q", documents }),
        );
        expect(res.status).toBe(400);
    });

    it("200s and wraps the comparison result in the envelope, forwarding user + body", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        mockRunEmbedding.mockResolvedValue({
            query: "q",
            documents: ["d1"],
            results: [
                {
                    model: "text-embedding-3-small",
                    query_vector: [0.1, 0.2],
                    document_vectors: [[0.1, 0.2]],
                    dim: 2,
                    scores: [{ index: 0, score: 0.99 }],
                    prompt_tokens: 3,
                    total_tokens: 3,
                    elapsed_ms: 12,
                },
            ],
        });

        const res = await embeddingPOST(
            postJson("/api/playground/embedding", { models: ["text-embedding-3-small"], query: "q", documents: ["d1"] }),
        );
        expect(res.status).toBe(200);
        const body = await envelope<{ results: { model: string; scores: { score: number }[] | null }[] }>(res);
        expect(body.data.results[0].model).toBe("text-embedding-3-small");
        expect(body.data.results[0].scores?.[0].score).toBe(0.99);

        expect(mockRunEmbedding).toHaveBeenCalledTimes(1);
        const [calledUser, calledBody] = mockRunEmbedding.mock.calls[0];
        expect(calledUser.id).toBe(user.id);
        expect(calledBody).toMatchObject({ models: ["text-embedding-3-small"], query: "q", documents: ["d1"] });
    });
});
