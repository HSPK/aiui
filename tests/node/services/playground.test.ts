import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import type { SessionUser } from "@/lib/server/auth";
import type { User } from "@/lib/server/db/schema";
import { HttpError } from "@/lib/server/response";
import type { AssembledToolCall, ForwardGenerationOpts } from "@/lib/server/gateway";
import { forwardGeneration, resolveModel } from "@/lib/server/gateway";
import { aggregateTools, executeTool } from "@/lib/server/mcp/runtime";
import { runEmbeddingComparison, sendPlaygroundChat } from "@/lib/server/playground";
import { pipeAndStripDone, replayDbMessageToWire } from "@/lib/server/playground/wire";
import type { PlaygroundChatInput, PlaygroundEmbeddingInput } from "@/lib/schemas/playground";
import { resetDb, seedConversation, seedMessage, seedUser } from "../../helpers/db";

// The gateway/mcp boundary is the network/upstream edge for this domain —
// mocked wholesale so no real HTTP call is ever attempted. Every OTHER
// export is preserved via `importOriginal` so any incidental transitive
// use (types, unrelated helpers) keeps working.
vi.mock("@/lib/server/gateway", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/gateway")>();
    return { ...actual, forwardGeneration: vi.fn(), resolveModel: vi.fn() };
});

vi.mock("@/lib/server/mcp/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/mcp/runtime")>();
    return { ...actual, aggregateTools: vi.fn(), executeTool: vi.fn() };
});

function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

// ---- forwardGeneration mock builders ----
// The orchestrator learns everything about a round through the
// `onStreamDelta` / `onComplete` callbacks in `opts` — NOT by parsing
// `response.body` (that's relayed byte-for-byte to the client via
// `pipeAndStripDone`). So a realistic mock must drive both: call the
// callbacks AND return a Response whose `.body` is a real
// ReadableStream (constructed via the real `Response` class so
// `.text()`/`.getReader()` behave exactly like production).

type ForwardCall = (
    user: SessionUser,
    capabilityId: string,
    body: Record<string, unknown>,
    opts?: ForwardGenerationOpts,
) => Promise<{ logId: string; response: Response }>;

function forwardOk(input: {
    content?: string;
    reasoning?: string;
    toolCalls?: AssembledToolCall[];
    finishReason?: string;
    error?: string;
    logId?: string;
    sse?: string;
}): ForwardCall {
    const {
        content = "",
        reasoning = "",
        toolCalls,
        finishReason = "stop",
        error,
        logId = `log-${Math.random().toString(36).slice(2)}`,
    } = input;
    const sse =
        input.sse ??
        `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\ndata: [DONE]\n\n`;
    return async (_user, _cap, _body, opts = {}) => {
        opts.onStreamDelta?.({ content, reasoning });
        opts.onComplete?.({ content, reasoning, toolCalls, finishReason, error });
        return { logId, response: new Response(sse, { status: 200 }) };
    };
}

function forwardHttpFail(status: number, text: string, logId = "log-fail"): ForwardCall {
    return async () => ({ logId, response: new Response(text, { status }) });
}

function forwardEmptyBody(logId = "log-empty"): ForwardCall {
    return async () => ({ logId, response: new Response(null, { status: 200 }) });
}

function forwardThrows(err: Error): ForwardCall {
    return async () => {
        throw err;
    };
}

function forwardPartialThenThrow(content: string, reasoning: string, err: Error): ForwardCall {
    return async (_user, _cap, _body, opts = {}) => {
        opts.onStreamDelta?.({ content, reasoning });
        throw err;
    };
}

/** Minimal SSE-block parser good enough to assert on the synthetic
 *  `loom_*` events plus the relayed upstream chunks, without pulling in
 *  a real SSE client library. */
function parseSseEvents(text: string): Array<{ event: string; data: unknown }> {
    const events: Array<{ event: string; data: unknown }> = [];
    for (const block of text.split("\n\n")) {
        if (!block.trim()) continue;
        let event = "message";
        let dataLine: string | undefined;
        for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice("event: ".length);
            else if (line.startsWith("data: ")) dataLine = line.slice("data: ".length);
            else if (line.startsWith("data:")) dataLine = line.slice("data:".length);
        }
        if (dataLine === undefined) continue;
        if (dataLine === "[DONE]") {
            events.push({ event: "done", data: "[DONE]" });
            continue;
        }
        try {
            events.push({ event, data: JSON.parse(dataLine) });
        } catch {
            events.push({ event, data: dataLine });
        }
    }
    return events;
}

async function drain(res: Response): Promise<string> {
    return res.text();
}

function activeMessages(conversationId: string) {
    return db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .all();
}

const BASE_CHAT_INPUT: PlaygroundChatInput = {
    content: "Hello there",
    model: "gpt-test",
};

describe("playground service", () => {
    beforeEach(() => {
        resetDb();
        vi.mocked(resolveModel).mockReset().mockResolvedValue({} as never);
        vi.mocked(forwardGeneration).mockReset();
        vi.mocked(aggregateTools).mockReset().mockResolvedValue({ tools: [], errors: [] });
        vi.mocked(executeTool).mockReset();
    });

    // =========================================================================
    // wire.ts — replayDbMessageToWire
    // =========================================================================
    describe("replayDbMessageToWire", () => {
        it("wraps plain string content as-is", () => {
            expect(replayDbMessageToWire("user", "hi there")).toEqual([
                { role: "user", content: "hi there" },
            ]);
        });

        it("falls back to extractText for non-array, non-string content", () => {
            expect(replayDbMessageToWire("user", 42)).toEqual([{ role: "user", content: "" }]);
            expect(replayDbMessageToWire("user", null)).toEqual([{ role: "user", content: "" }]);
        });

        it("splits role:tool content into one wire message per tool_result part", () => {
            const content = [
                { type: "tool_result", tool_result: { tool_call_id: "call-1", content: "42", is_error: false } },
            ];
            expect(replayDbMessageToWire("tool", content)).toEqual([
                { role: "tool", content: "42", tool_call_id: "call-1" },
            ]);
        });

        it("ignores non-tool_result parts under role:tool and can yield an empty array", () => {
            const content = [{ type: "text", text: "should be ignored under tool role" }];
            expect(replayDbMessageToWire("tool", content)).toEqual([]);
        });

        it("folds multiple tool_call parts on an assistant turn into one message's tool_calls[]", () => {
            const content = [
                { type: "tool_call", tool_call: { id: "c1", name: "srv__a", arguments: "{}" } },
                { type: "tool_call", tool_call: { id: "c2", name: "srv__b", arguments: "{}" } },
            ];
            const out = replayDbMessageToWire("assistant", content);
            expect(out).toEqual([
                {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                        { id: "c1", type: "function", function: { name: "srv__a", arguments: "{}" } },
                        { id: "c2", type: "function", function: { name: "srv__b", arguments: "{}" } },
                    ],
                },
            ]);
        });

        it("keeps visible parts as an array (no lossy flatten-to-string) alongside tool_calls", () => {
            const content = [
                { type: "text", text: "let me check" },
                { type: "tool_call", tool_call: { id: "c1", name: "srv__a", arguments: "{}" } },
            ];
            const out = replayDbMessageToWire("assistant", content);
            expect(out).toEqual([
                {
                    role: "assistant",
                    content: [{ type: "text", text: "let me check" }],
                    tool_calls: [{ id: "c1", type: "function", function: { name: "srv__a", arguments: "{}" } }],
                },
            ]);
        });

        it("returns plain content (array) with no tool_calls key for a non-assistant role", () => {
            const content = [{ type: "text", text: "hi" }];
            const out = replayDbMessageToWire("system", content);
            expect(out).toEqual([{ role: "system", content: [{ type: "text", text: "hi" }] }]);
            expect(out[0]).not.toHaveProperty("tool_calls");
        });

        it("drops a tool_call part attributed to a non-assistant role (defensive branch)", () => {
            // Shouldn't happen in practice (the app only ever writes tool_call
            // parts on assistant-authored rows) but the function doesn't gate
            // on role when extracting tool_call parts, only when attaching
            // them to the outgoing message — document the resulting shape.
            const content = [{ type: "tool_call", tool_call: { id: "c1", name: "x", arguments: "{}" } }];
            const out = replayDbMessageToWire("user", content);
            expect(out).toEqual([{ role: "user", content: "" }]);
        });

        it("returns an empty array for an empty content array", () => {
            expect(replayDbMessageToWire("user", [])).toEqual([]);
        });

        it("tolerates a stray tool_result part appearing outside role:tool", () => {
            const content = [
                { type: "text", text: "visible" },
                { type: "tool_result", tool_result: { tool_call_id: "c1", content: "x", is_error: false } },
            ];
            const out = replayDbMessageToWire("assistant", content);
            expect(out).toEqual([{ role: "assistant", content: [{ type: "text", text: "visible" }] }]);
        });
    });

    // =========================================================================
    // wire.ts — pipeAndStripDone
    // =========================================================================
    describe("pipeAndStripDone", () => {
        async function run(source: string | ReadableStream<Uint8Array>): Promise<string> {
            const src = typeof source === "string" ? new Response(source).body! : source;
            const sink = new ReadableStream<Uint8Array>({
                async start(controller) {
                    await pipeAndStripDone(src, controller);
                    controller.close();
                },
            });
            return new Response(sink).text();
        }

        it("relays ordinary SSE lines verbatim", async () => {
            const out = await run('data: {"a":1}\n\ndata: {"a":2}\n\n');
            expect(out).toBe('data: {"a":1}\n\ndata: {"a":2}\n\n');
        });

        it("strips a `data: [DONE]` line (with space) — its blank separator line passes through untouched", async () => {
            // Only the `data: [DONE]` line itself is dropped; the blank
            // line that follows it is a distinct "line" from the
            // splitter's point of view and isn't matched by the DONE
            // check, so it's relayed as-is. Harmless in SSE framing
            // (an extra blank line between records is a no-op for any
            // spec-compliant EventSource parser).
            const out = await run('data: {"a":1}\n\ndata: [DONE]\n\n');
            expect(out).toBe('data: {"a":1}\n\n\n');
        });

        it("strips a `data:[DONE]` line (no space)", async () => {
            const out = await run('data: {"a":1}\n\ndata:[DONE]\n\n');
            expect(out).toBe('data: {"a":1}\n\n\n');
        });

        it("reassembles a line split mid-chunk across two reads before deciding to strip it", async () => {
            const enc = new TextEncoder();
            const source = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(enc.encode('data: {"a":1}\n\ndata: [DO'));
                    controller.enqueue(enc.encode('NE]\n\n'));
                    controller.close();
                },
            });
            const out = await run(source);
            expect(out).toBe('data: {"a":1}\n\n\n');
        });

        it("flushes a trailing line with no terminating newline", async () => {
            const out = await run('data: {"a":1}\n\ndata: {"a":2}');
            expect(out).toBe('data: {"a":1}\n\ndata: {"a":2}');
        });

        it("drops a trailing [DONE] line that has no terminating newline", async () => {
            const out = await run('data: {"a":1}\n\ndata: [DONE]');
            expect(out).toBe('data: {"a":1}\n\n');
        });

        it("produces just the orphaned blank separator line for an all-[DONE] stream", async () => {
            const out = await run("data: [DONE]\n\n");
            expect(out).toBe("\n");
        });

        it("buffers a newline-less fragment silently (no premature flush) until a terminator arrives", async () => {
            const enc = new TextEncoder();
            const source = new ReadableStream<Uint8Array>({
                start(controller) {
                    // This chunk has no "\n" at all, so after popping it
                    // into `carry` the loop's `lines` array is empty and
                    // nothing should be enqueued yet for this read.
                    controller.enqueue(enc.encode('data: {"partial":true}'));
                    controller.enqueue(enc.encode("\n\n"));
                    controller.close();
                },
            });
            const out = await run(source);
            expect(out).toBe('data: {"partial":true}\n\n');
        });
    });

    // =========================================================================
    // embedding.ts — runEmbeddingComparison
    // =========================================================================
    describe("runEmbeddingComparison", () => {
        const BASE_EMBED_INPUT: PlaygroundEmbeddingInput = {
            models: ["embed-a"],
            query: "hello world",
            documents: ["doc one", "doc two"],
        };

        function embedResponse(vectors: Array<number[] | null>, usage?: Record<string, number>) {
            return async (_user: SessionUser, _cap: string, _body: Record<string, unknown>) => ({
                logId: "log-embed",
                response: new Response(
                    JSON.stringify({
                        data: vectors.map((embedding, index) => (embedding ? { index, embedding } : { index })),
                        usage,
                    }),
                    { status: 200 },
                ),
            });
        }

        it("embeds the query + documents and returns per-document cosine scores", async () => {
            vi.mocked(forwardGeneration).mockImplementation(
                embedResponse([[1, 0], [1, 0], [0, 1]], { prompt_tokens: 5, total_tokens: 5 }),
            );
            const result = await runEmbeddingComparison(
                toSessionUser(seedUser()),
                BASE_EMBED_INPUT,
            );
            expect(result.query).toBe("hello world");
            expect(result.documents).toEqual(["doc one", "doc two"]);
            expect(result.results).toHaveLength(1);
            const [r] = result.results;
            expect(r.model).toBe("embed-a");
            expect(r.query_vector).toEqual([1, 0]);
            expect(r.document_vectors).toEqual([[1, 0], [0, 1]]);
            expect(r.dim).toBe(2);
            expect(r.scores).toEqual([
                { index: 0, score: 1 },
                { index: 1, score: 0 },
            ]);
            expect(r.prompt_tokens).toBe(5);
            expect(r.total_tokens).toBe(5);
            expect(r.error).toBeUndefined();
        });

        it("fans out one upstream call per model and keeps results in request order", async () => {
            vi.mocked(forwardGeneration)
                .mockImplementationOnce(embedResponse([[1, 0], [1, 0]]))
                .mockImplementationOnce(embedResponse([[0, 1], [0, 1]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                models: ["model-a", "model-b"],
                documents: ["only doc"],
            });
            expect(forwardGeneration).toHaveBeenCalledTimes(2);
            expect(result.results.map((r) => r.model)).toEqual(["model-a", "model-b"]);
            const bodies = vi.mocked(forwardGeneration).mock.calls.map((c) => c[2]);
            expect(bodies[0].model).toBe("model-a");
            expect(bodies[1].model).toBe("model-b");
            expect(bodies[0].input).toEqual(["hello world", "only doc"]);
        });

        it("captures a per-model HTTP failure without breaking sibling models", async () => {
            vi.mocked(forwardGeneration)
                .mockImplementationOnce(async () => ({
                    logId: "log-fail",
                    response: new Response("rate limited", { status: 429 }),
                }))
                .mockImplementationOnce(embedResponse([[1, 0], [1, 0]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                models: ["bad-model", "good-model"],
                documents: ["only doc"],
            });
            const [bad, good] = result.results;
            expect(bad.error).toBe("rate limited");
            expect(bad.query_vector).toBeNull();
            expect(bad.document_vectors).toEqual([null]);
            expect(bad.scores).toBeNull();
            expect(good.error).toBeUndefined();
            expect(good.query_vector).toEqual([1, 0]);
        });

        it("falls back to statusText when the failing response body can't be read as text", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => ({
                logId: "log-fail",
                response: {
                    ok: false,
                    status: 500,
                    statusText: "Internal Server Error",
                    text: async () => {
                        throw new Error("stream already used");
                    },
                } as unknown as Response,
            }));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), BASE_EMBED_INPUT);
            expect(result.results[0].error).toBe("Internal Server Error");
        });

        it("captures a thrown network error per-model with correctly-sized null arrays", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => {
                throw new Error("ECONNRESET");
            });
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["d1", "d2", "d3"],
            });
            const [r] = result.results;
            expect(r.error).toBe("ECONNRESET");
            expect(r.document_vectors).toEqual([null, null, null]);
            expect(r.query_vector).toBeNull();
        });

        it("stringifies a non-Error thrown value rather than crashing the fan-out", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => {
                // Deliberately a non-Error rejection: typed `unknown` so it is a
                // real runtime string without tripping the throw-an-Error lint.
                const rawThrown: unknown = "raw string rejection";
                throw rawThrown;
            });
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), BASE_EMBED_INPUT);
            expect(result.results[0].error).toBe("raw string rejection");
        });

        it("treats a response body with no `data` field as zero embeddings rather than throwing", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => ({
                logId: "log-no-data",
                response: new Response(JSON.stringify({}), { status: 200 }),
            }));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), BASE_EMBED_INPUT);
            const [r] = result.results;
            expect(r.query_vector).toBeNull();
            expect(r.document_vectors).toEqual([null, null]);
            expect(r.dim).toBeNull();
            expect(r.error).toBeUndefined();
        });

        it("falls back dim to the first defined document vector's length when the query vector is missing", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([null, null, [1, 2, 3]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), BASE_EMBED_INPUT);
            const [r] = result.results;
            expect(r.query_vector).toBeNull();
            expect(r.dim).toBe(3);
            expect(r.scores).toBeNull();
        });

        it("keeps dim at 0 (not null) for a legitimately empty query vector — `??` not `||`", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[], [1, 2]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), BASE_EMBED_INPUT);
            expect(result.results[0].dim).toBe(0);
        });

        it("yields dim null when every vector (query + all documents) is missing", async () => {
            vi.mocked(forwardGeneration).mockImplementation(
                async () => ({ logId: "log-empty", response: new Response(JSON.stringify({ data: [] }), { status: 200 }) }),
            );
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), BASE_EMBED_INPUT);
            const [r] = result.results;
            expect(r.dim).toBeNull();
            expect(r.query_vector).toBeNull();
            expect(r.document_vectors).toEqual([null, null]);
        });

        it("aligns vectors by explicit out-of-order `index` fields rather than array position", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => ({
                logId: "log-idx",
                response: new Response(
                    JSON.stringify({
                        data: [
                            { index: 2, embedding: [0, 0, 1] },
                            { index: 0, embedding: [1, 0, 0] },
                            { index: 1, embedding: [0, 1, 0] },
                        ],
                    }),
                    { status: 200 },
                ),
            }));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["d1", "d2"],
            });
            const [r] = result.results;
            expect(r.query_vector).toEqual([1, 0, 0]);
            expect(r.document_vectors).toEqual([[0, 1, 0], [0, 0, 1]]);
        });

        it("falls back to sequential positions when `index` is omitted from every entry", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => ({
                logId: "log-seq",
                response: new Response(
                    JSON.stringify({ data: [{ embedding: [9, 9] }, { embedding: [8, 8] }] }),
                    { status: 200 },
                ),
            }));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            expect(result.results[0].query_vector).toEqual([9, 9]);
            expect(result.results[0].document_vectors).toEqual([[8, 8]]);
        });

        it("drops entries whose `index` is out of range for the request", async () => {
            vi.mocked(forwardGeneration).mockImplementation(async () => ({
                logId: "log-oor",
                response: new Response(
                    JSON.stringify({ data: [{ index: 0, embedding: [1, 1] }, { index: 99, embedding: [2, 2] }] }),
                    { status: 200 },
                ),
            }));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            expect(result.results[0].query_vector).toEqual([1, 1]);
            expect(result.results[0].document_vectors).toEqual([null]);
        });

        it("scores a zero-magnitude document vector as 0 without dividing by zero", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[1, 1], [0, 0]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            expect(result.results[0].scores).toEqual([{ index: 0, score: 0 }]);
        });

        it("scores every document as 0 when the query vector itself has zero magnitude", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[0, 0], [5, 5]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            expect(result.results[0].scores).toEqual([{ index: 0, score: 0 }]);
        });

        it("scores a missing (null) document vector as 0 via the outer ternary", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[1, 1], null]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            expect(result.results[0].document_vectors).toEqual([null]);
            expect(result.results[0].scores).toEqual([{ index: 0, score: 0 }]);
        });

        it("defaults prompt/total tokens to null when usage is absent from the upstream response", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[1], [1]]));
            const result = await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            expect(result.results[0].prompt_tokens).toBeNull();
            expect(result.results[0].total_tokens).toBeNull();
        });

        it("forwards every set optional embedding param and omits unset ones", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[1], [1]]));
            await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
                params: { dimensions: 256, encoding_format: "float", input_type: "search_document", user: "u1" },
            });
            const body = vi.mocked(forwardGeneration).mock.calls[0][2];
            expect(body.dimensions).toBe(256);
            expect(body.encoding_format).toBe("float");
            expect(body.input_type).toBe("search_document");
            expect(body.user).toBe("u1");
        });

        it("omits every optional param key when params is unset", async () => {
            vi.mocked(forwardGeneration).mockImplementation(embedResponse([[1], [1]]));
            await runEmbeddingComparison(toSessionUser(seedUser()), {
                ...BASE_EMBED_INPUT,
                documents: ["only doc"],
            });
            const body = vi.mocked(forwardGeneration).mock.calls[0][2];
            expect(body).not.toHaveProperty("dimensions");
            expect(body).not.toHaveProperty("encoding_format");
            expect(body).not.toHaveProperty("input_type");
            expect(body).not.toHaveProperty("user");
        });
    });

    // =========================================================================
    // service.ts — sendPlaygroundChat
    // =========================================================================
    describe("sendPlaygroundChat", () => {
        function toolAggregation() {
            return {
                tools: [
                    {
                        qualifiedName: "srv__weather",
                        localName: "weather",
                        description: "get weather",
                        parameters: {},
                        serverId: "srv-1",
                        serverName: "srv",
                    },
                ],
                errors: [],
            };
        }

        describe("validation", () => {
            it("propagates resolveModel's HttpError before touching the database", async () => {
                vi.mocked(resolveModel).mockRejectedValue(new HttpError("Model \"bad\" is disabled", 400, -1));
                const user = seedUser();
                await expect(
                    sendPlaygroundChat(toSessionUser(user), { ...BASE_CHAT_INPUT, model: "bad" }),
                ).rejects.toMatchObject({ status: 400 });
                expect(db.select().from(schema.conversations).all()).toHaveLength(0);
                expect(db.select().from(schema.messages).all()).toHaveLength(0);
            });

            it("rejects an all-blank string content turn with 403 before creating any rows", async () => {
                const user = seedUser();
                await expect(
                    sendPlaygroundChat(toSessionUser(user), { ...BASE_CHAT_INPUT, content: "   " }),
                ).rejects.toMatchObject({ status: 403 });
                expect(db.select().from(schema.conversations).all()).toHaveLength(0);
            });

            it("rejects an all-blank array-of-text-parts turn with 403", async () => {
                const user = seedUser();
                await expect(
                    sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        content: [{ type: "text", text: "  " }],
                    }),
                ).rejects.toMatchObject({ status: 403 });
            });

            it("allows a blank-text turn through when a non-text part is present (e.g. an image)", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "described the image" }));
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
                });
                await drain(res);
                const convs = db.select().from(schema.conversations).all();
                expect(convs).toHaveLength(1);
                expect(convs[0].title).toBe("New Chat");
            });
        });

        describe("conversation lifecycle", () => {
            it("creates a new conversation with a truncated title when none is provided", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const longText = "x".repeat(80);
                const res = await sendPlaygroundChat(toSessionUser(user), { ...BASE_CHAT_INPUT, content: longText });
                await drain(res);
                const convs = db.select().from(schema.conversations).all();
                expect(convs).toHaveLength(1);
                expect(convs[0].title).toBe("x".repeat(40));
                expect(convs[0].userId).toBe(user.id);
                expect(convs[0].config).toEqual({ model: BASE_CHAT_INPUT.model });
            });

            it("reuses and bumps updatedAt on an existing conversation owned by the same user", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const conv = seedConversation({ userId: user.id, updatedAt: "2020-01-01T00:00:00.000Z" });
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    conversation_id: conv.id,
                });
                await drain(res);
                const after = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
                expect(after.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
                expect(db.select().from(schema.conversations).all()).toHaveLength(1);
            });

            it("forbids sending into a conversation owned by another user", async () => {
                const owner = seedUser({ username: "owner" });
                const attacker = seedUser({ username: "attacker" });
                const conv = seedConversation({ userId: owner.id });
                await expect(
                    sendPlaygroundChat(toSessionUser(attacker), { ...BASE_CHAT_INPUT, conversation_id: conv.id }),
                ).rejects.toMatchObject({ status: 403 });
                expect(activeMessages(conv.id)).toHaveLength(0);
            });

            it("forbids resurrecting a soft-deleted conversation", async () => {
                const user = seedUser();
                const conv = seedConversation({ userId: user.id, isDeleted: true });
                await expect(
                    sendPlaygroundChat(toSessionUser(user), { ...BASE_CHAT_INPUT, conversation_id: conv.id }),
                ).rejects.toMatchObject({ status: 403 });
            });
        });

        describe("message id security", () => {
            it("rejects a caller-provided message id that already belongs to another conversation", async () => {
                const user = seedUser();
                const otherConv = seedConversation({ userId: user.id });
                const victimMessage = seedMessage({ conversationId: otherConv.id, role: "user", content: "victim" });
                await expect(
                    sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        user_message_id: victimMessage.id,
                    }),
                ).rejects.toMatchObject({ status: 403 });
            });

            it("rejects a caller-provided assistant_message_id belonging to another conversation", async () => {
                const user = seedUser();
                const otherConv = seedConversation({ userId: user.id });
                const victimMessage = seedMessage({ conversationId: otherConv.id, role: "assistant", content: "victim" });
                await expect(
                    sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        assistant_message_id: victimMessage.id,
                    }),
                ).rejects.toMatchObject({ status: 403 });
            });

            it("generates fresh UUIDs for user/assistant message ids when none are supplied", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                await drain(res);
                const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                expect(res.headers.get("X-Conversation-ID")).toMatch(uuidRe);
                expect(res.headers.get("X-Message-ID")).toMatch(uuidRe);
                const rows = activeMessages(res.headers.get("X-Conversation-ID")!);
                expect(rows.find((m) => m.role === "user")).toBeTruthy();
                expect(rows.find((m) => m.id === res.headers.get("X-Message-ID"))).toBeTruthy();
            });

            it("prunes orphaned tool rows under a reused assistant_message_id before regenerating", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "second attempt" }));
                const user = seedUser();
                const conv = seedConversation({ userId: user.id });
                const oldAssistant = seedMessage({ conversationId: conv.id, role: "assistant", content: "old", error: "boom" });
                const staleTool = seedMessage({
                    conversationId: conv.id,
                    role: "tool",
                    parentId: oldAssistant.id,
                    content: [{ type: "tool_result", tool_result: { tool_call_id: "x", content: "old", is_error: false } }],
                });
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    conversation_id: conv.id,
                    assistant_message_id: oldAssistant.id,
                });
                await drain(res);
                const rows = activeMessages(conv.id);
                expect(rows.find((m) => m.id === staleTool.id)).toBeUndefined();
                const assistantRow = rows.find((m) => m.id === oldAssistant.id)!;
                expect(assistantRow.error).toBeNull();
            });
        });

        describe("history assembly", () => {
            it("prepends a system message to the upstream history when body.system is set", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                await drain(
                    await sendPlaygroundChat(toSessionUser(user), { ...BASE_CHAT_INPUT, system: "be terse" }),
                );
                const sentMessages = vi.mocked(forwardGeneration).mock.calls[0][2].messages as Array<{ role: string; content: unknown }>;
                expect(sentMessages[0]).toEqual({ role: "system", content: "be terse" });
            });

            it("replays only the most recent `history_limit` active messages, oldest-first", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const conv = seedConversation({ userId: user.id });
                // Seeded messages must be timestamped RELATIVE TO NOW (not a
                // fixed past date) since the turn's freshly-inserted user
                // row always carries a real `new Date().toISOString()` —
                // limit=N caps the TOTAL row count by recency, including
                // that brand-new row, so seeded fixtures need to compete on
                // a comparable clock.
                const now = Date.now();
                for (let i = 0; i < 5; i++) {
                    seedMessage({
                        conversationId: conv.id,
                        role: i % 2 === 0 ? "user" : "assistant",
                        content: `msg-${i}`,
                        createdAt: new Date(now - (5 - i) * 1000).toISOString(),
                    });
                }
                await drain(
                    await sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        conversation_id: conv.id,
                        history_limit: 3,
                    }),
                );
                const sentMessages = vi.mocked(forwardGeneration).mock.calls[0][2].messages as Array<{ content: unknown }>;
                // 3 most recent rows overall: msg-3, msg-4, plus the
                // freshly-inserted user turn (always the newest). A
                // single-text-part array round-trips as an ARRAY (not a
                // flattened string) per replayDbMessageToWire's contract.
                expect(sentMessages.map((m) => m.content)).toEqual([
                    "msg-3",
                    "msg-4",
                    [{ type: "text", text: "Hello there" }],
                ]);
            });

            it("honors the legacy conv_histrory_limit field when history_limit is unset", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const conv = seedConversation({ userId: user.id });
                const now = Date.now();
                for (let i = 0; i < 4; i++) {
                    seedMessage({
                        conversationId: conv.id,
                        role: "user",
                        content: `msg-${i}`,
                        createdAt: new Date(now - (4 - i) * 1000).toISOString(),
                    });
                }
                await drain(
                    await sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        conversation_id: conv.id,
                        conv_histrory_limit: 2,
                    }),
                );
                const sentMessages = vi.mocked(forwardGeneration).mock.calls[0][2].messages as Array<{ content: unknown }>;
                expect(sentMessages.map((m) => m.content)).toEqual([
                    "msg-3",
                    [{ type: "text", text: "Hello there" }],
                ]);
            });

            it("drops an errored assistant AND its orphaned tool children from history replay", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const conv = seedConversation({ userId: user.id });
                const base = Date.parse("2024-01-01T00:00:00.000Z");
                const erroredAssistant = seedMessage({
                    conversationId: conv.id,
                    role: "assistant",
                    content: "failed turn",
                    error: "upstream boom",
                    createdAt: new Date(base).toISOString(),
                });
                seedMessage({
                    conversationId: conv.id,
                    role: "tool",
                    parentId: erroredAssistant.id,
                    content: [{ type: "tool_result", tool_result: { tool_call_id: "c1", content: "x", is_error: false } }],
                    createdAt: new Date(base + 1000).toISOString(),
                });
                await drain(
                    await sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        conversation_id: conv.id,
                        history_limit: 10,
                    }),
                );
                const sentMessages = vi.mocked(forwardGeneration).mock.calls[0][2].messages as Array<{ role: string }>;
                expect(sentMessages.some((m) => m.role === "tool")).toBe(false);
                expect(sentMessages.some((m) => m.role === "assistant")).toBe(false);
            });

            it("drops a tool row whose assistant parent fell outside the history window", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const conv = seedConversation({ userId: user.id });
                const now = Date.now();
                // The assistant parent is old enough to be excluded by
                // limit:2 outright; its tool child is recent enough to
                // BE fetched by the same limit — so this genuinely
                // exercises the `!presentIds.has(parent)` branch (the
                // tool row IS iterated, but its parent lookup misses),
                // rather than the tool row simply never being selected.
                const oldAssistant = seedMessage({
                    conversationId: conv.id,
                    role: "assistant",
                    content: "ok",
                    createdAt: new Date(now - 10_000).toISOString(),
                });
                seedMessage({
                    conversationId: conv.id,
                    role: "tool",
                    parentId: oldAssistant.id,
                    content: [{ type: "tool_result", tool_result: { tool_call_id: "c1", content: "x", is_error: false } }],
                    createdAt: new Date(now - 500).toISOString(),
                });
                await drain(
                    await sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        conversation_id: conv.id,
                        history_limit: 2,
                    }),
                );
                const sentMessages = vi.mocked(forwardGeneration).mock.calls[0][2].messages as Array<{ role: string }>;
                expect(sentMessages.some((m) => m.role === "tool")).toBe(false);
            });
        });

        describe("mcp tool aggregation", () => {
            it("never calls aggregateTools when no mcp servers are enabled for the turn", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                await drain(await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT));
                expect(aggregateTools).not.toHaveBeenCalled();
                const body = vi.mocked(forwardGeneration).mock.calls[0][2];
                expect(body).not.toHaveProperty("tools");
            });

            it("surfaces per-server aggregation errors as loom_tool_error events up front", async () => {
                vi.mocked(aggregateTools).mockResolvedValue({
                    tools: [],
                    errors: [{ serverId: "srv-1", serverName: "flaky", message: "connection refused" }],
                });
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });
                const text = await drain(res);
                const events = parseSseEvents(text);
                const toolErrorEvent = events.find((e) => e.event === "loom_tool_error");
                expect(toolErrorEvent?.data).toEqual({
                    server_id: "srv-1",
                    server_name: "flaky",
                    message: "connection refused",
                });
                // Surfaced before the model ever starts responding.
                expect(events[0].event).toBe("loom_tool_error");
            });
        });

        describe("successful chat turn", () => {
            it("streams a single-round answer, persists the assistant row, and terminates with exactly one [DONE]", async () => {
                vi.mocked(forwardGeneration).mockImplementation(
                    forwardOk({ content: "General Kenobi", logId: "log-abc", sse: 'data: {"delta":"General Kenobi"}\n\ndata: [DONE]\n\n' }),
                );
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                expect(res.status).toBe(200);
                expect(res.headers.get("Content-Type")).toBe("text/event-stream");
                const text = await drain(res);
                expect((text.match(/\[DONE\]/g) ?? []).length).toBe(1);
                const events = parseSseEvents(text);
                const metaEvent = events.find((e) => e.event === "loom_message_meta");
                expect(metaEvent?.data).toMatchObject({ generation_id: "log-abc" });

                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([{ type: "text", text: "General Kenobi" }]);
                expect(assistantRow.modelId).toBe(BASE_CHAT_INPUT.model);
                expect(assistantRow.generationId).toBe("log-abc");
                expect(assistantRow.error).toBeNull();
                expect(assistantRow.isActive).toBe(true);
            });

            it("forwards every set sampling param and omits unset ones", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                await drain(
                    await sendPlaygroundChat(toSessionUser(user), {
                        ...BASE_CHAT_INPUT,
                        temperature: 0.5,
                        max_tokens: 100,
                        top_p: 0.9,
                        frequency_penalty: 0.1,
                        presence_penalty: 0.2,
                        reasoning_effort: "high",
                        stream: false,
                    }),
                );
                const body = vi.mocked(forwardGeneration).mock.calls[0][2];
                expect(body).toMatchObject({
                    temperature: 0.5,
                    max_tokens: 100,
                    top_p: 0.9,
                    frequency_penalty: 0.1,
                    presence_penalty: 0.2,
                    reasoning_effort: "high",
                    stream: false,
                });
            });

            it("omits every optional sampling param when unset and defaults stream to true", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardOk({ content: "hi" }));
                const user = seedUser();
                await drain(await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT));
                const body = vi.mocked(forwardGeneration).mock.calls[0][2];
                expect(body.stream).toBe(true);
                for (const k of ["temperature", "max_tokens", "top_p", "frequency_penalty", "presence_penalty", "reasoning_effort"]) {
                    expect(body).not.toHaveProperty(k);
                }
            });
        });

        describe("tool execution loop", () => {
            it("runs a full hop: model calls a tool, result is persisted + relayed, then a final answer streams", async () => {
                vi.mocked(aggregateTools).mockResolvedValue(toolAggregation());
                vi.mocked(executeTool).mockResolvedValue({ content: "72F sunny", isError: false, serverName: "srv" });
                vi.mocked(forwardGeneration)
                    .mockImplementationOnce(
                        forwardOk({
                            reasoning: "I should check the weather tool.",
                            toolCalls: [{ id: "call-1", name: "srv__weather", arguments: '{"city":"LA"}' }],
                            finishReason: "tool_calls",
                        }),
                    )
                    .mockImplementationOnce(
                        forwardOk({ content: "It's 72F and sunny.", reasoning: "The tool says 72F.", finishReason: "stop" }),
                    );

                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });
                const text = await drain(res);

                expect(forwardGeneration).toHaveBeenCalledTimes(2);
                expect(executeTool).toHaveBeenCalledWith("srv__weather", '{"city":"LA"}');

                const events = parseSseEvents(text);
                const toolResultEvent = events.find((e) => e.event === "loom_tool_result");
                expect(toolResultEvent?.data).toEqual({
                    call_id: "call-1",
                    name: "srv__weather",
                    content: "72F sunny",
                    is_error: false,
                    source: "srv",
                });

                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const rows = activeMessages(conversationId);
                const toolRow = rows.find((m) => m.role === "tool")!;
                expect(toolRow.parentId).toBe(assistantId);
                expect(toolRow.content).toEqual([
                    {
                        type: "tool_result",
                        tool_result: { tool_call_id: "call-1", name: "srv__weather", content: "72F sunny", is_error: false, source: "srv" },
                    },
                ]);

                const assistantRow = rows.find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([
                    { type: "tool_call", tool_call: { id: "call-1", name: "srv__weather", arguments: '{"city":"LA"}', source: "srv" } },
                    { type: "text", text: "It's 72F and sunny." },
                ]);
                // Reasoning from both hops is concatenated (blank-line
                // separated), not overwritten by the final round only.
                expect(assistantRow.reasoningContent).toBe("I should check the weather tool.\n\nThe tool says 72F.");

                // Second round's upstream history includes the assistant's
                // tool_calls envelope AND the tool result message.
                const secondRoundMessages = vi.mocked(forwardGeneration).mock.calls[1][2].messages as Array<Record<string, unknown>>;
                const assistantEnvelope = secondRoundMessages.find((m) => m.role === "assistant" && m.tool_calls);
                expect(assistantEnvelope?.tool_calls).toEqual([
                    { id: "call-1", type: "function", function: { name: "srv__weather", arguments: '{"city":"LA"}' } },
                ]);
                const toolEnvelope = secondRoundMessages.find((m) => m.role === "tool");
                expect(toolEnvelope).toEqual({ role: "tool", content: "72F sunny", tool_call_id: "call-1" });
            });

            it("synthesizes an error tool-result for a call naming a tool outside the aggregated set, without invoking executeTool", async () => {
                vi.mocked(aggregateTools).mockResolvedValue(toolAggregation());
                vi.mocked(forwardGeneration)
                    .mockImplementationOnce(
                        forwardOk({
                            toolCalls: [{ id: "call-1", name: "unknown__ghost", arguments: "{}" }],
                            finishReason: "tool_calls",
                        }),
                    )
                    .mockImplementationOnce(forwardOk({ content: "done", finishReason: "stop" }));

                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });
                await drain(res);
                expect(executeTool).not.toHaveBeenCalled();
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const toolRow = activeMessages(conversationId).find((m) => m.role === "tool")!;
                const part = (toolRow.content as Array<{ tool_result: { content: string; is_error: boolean } }>)[0];
                expect(part.tool_result.is_error).toBe(true);
                expect(part.tool_result.content).toContain("No MCP server has a tool called");
            });

            it("bails out with a loom_error and a persisted error row after MAX_TOOL_HOPS is reached", async () => {
                vi.mocked(aggregateTools).mockResolvedValue(toolAggregation());
                vi.mocked(executeTool).mockResolvedValue({ content: "again", isError: false, serverName: "srv" });
                vi.mocked(forwardGeneration).mockImplementation(
                    forwardOk({
                        toolCalls: [{ id: "call-loop", name: "srv__weather", arguments: "{}" }],
                        finishReason: "tool_calls",
                    }),
                );
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });
                const text = await drain(res);
                expect(forwardGeneration).toHaveBeenCalledTimes(8);
                const events = parseSseEvents(text);
                const errEvent = events.find((e) => e.event === "loom_error");
                expect(errEvent?.data).toMatchObject({ message: expect.stringContaining("maximum tool execution hops") });

                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.error).toContain("maximum tool execution hops");
            });

            it("aborts before dispatching tool calls when the client cancels while the tool-call round's SSE is still being relayed", async () => {
                vi.mocked(aggregateTools).mockResolvedValue(toolAggregation());
                let releaseGate!: () => void;
                const gate = new Promise<void>((resolve) => {
                    releaseGate = resolve;
                });
                vi.mocked(forwardGeneration).mockImplementation(async (_user, _cap, _body, opts = {}) => {
                    opts.onStreamDelta?.({ content: "", reasoning: "" });
                    opts.onComplete?.({
                        content: "",
                        reasoning: "",
                        toolCalls: [{ id: "call-1", name: "srv__weather", arguments: "{}" }],
                        finishReason: "tool_calls",
                    });
                    // Gate the *body*, not the forwardGeneration call
                    // itself, so the round is already past the
                    // immediately-after-forwardGeneration abort check
                    // (and into relaying its SSE) by the time the test
                    // cancels — landing the cancel between "round done"
                    // and "dispatch its tool calls".
                    const gatedBody = new ReadableStream<Uint8Array>({
                        async pull(controller) {
                            await gate;
                            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                            controller.close();
                        },
                    });
                    return { logId: "log-tool-abort", response: new Response(gatedBody, { status: 200 }) };
                });
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });

                await res.body!.cancel();
                releaseGate();
                await new Promise((resolve) => setTimeout(resolve, 50));

                expect(executeTool).not.toHaveBeenCalled();
            });
        });

        describe("upstream failure handling", () => {
            it("persists an HTTP-failure error and emits loom_error when the upstream responds non-2xx", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardHttpFail(503, "Service Unavailable"));
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toMatchObject({
                    message: expect.stringContaining("HTTP 503"),
                });
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.error).toContain("HTTP 503");
            });

            it("treats an ok response with a null body as an upstream failure", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardEmptyBody());
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toMatchObject({
                    message: "Upstream returned empty stream",
                });
            });

            it("persists a mid-stream terminal-failure event (HTTP 200 + onComplete error) as a chat-row error", async () => {
                vi.mocked(forwardGeneration).mockImplementation(
                    forwardOk({ content: "partial", error: "response.failed: content_policy_violation" }),
                );
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toEqual({
                    message: "response.failed: content_policy_violation",
                });
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.error).toBe("response.failed: content_policy_violation");
            });

            it("persists whatever streamed before a thrown network error and marks the row failed", async () => {
                vi.mocked(forwardGeneration).mockImplementation(
                    forwardPartialThenThrow("partial answ", "", new Error("ECONNRESET")),
                );
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toEqual({ message: "ECONNRESET" });
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([{ type: "text", text: "partial answ" }]);
                expect(assistantRow.error).toBe("ECONNRESET");
            });

            it("still creates an (empty-content) error row when forwardGeneration throws with no prior stream deltas", async () => {
                vi.mocked(forwardGeneration).mockImplementation(forwardThrows(new Error("dns failure")));
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                await drain(res);
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([{ type: "text", text: "" }]);
                expect(assistantRow.error).toBe("dns failure");
            });

            it("stringifies a non-Error thrown value from forwardGeneration (not aborted) rather than crashing the stream", async () => {
                vi.mocked(forwardGeneration).mockImplementation(async () => {
                    // Deliberately a non-Error rejection: typed `unknown` so it is a
                    // real runtime string without tripping the throw-an-Error lint.
                    const rawThrown2: unknown = "raw upstream rejection";
                    throw rawThrown2;
                });
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toEqual({ message: "raw upstream rejection" });
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.error).toBe("raw upstream rejection");
            });

            it("catches a thrown executeTool (contract violation) via the outer catch-all and still emits loom_error", async () => {
                vi.mocked(aggregateTools).mockResolvedValue(toolAggregation());
                vi.mocked(executeTool).mockRejectedValue(new Error("executeTool exploded"));
                vi.mocked(forwardGeneration).mockImplementation(
                    forwardOk({
                        toolCalls: [{ id: "call-1", name: "srv__weather", arguments: "{}" }],
                        finishReason: "tool_calls",
                    }),
                );
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toEqual({ message: "executeTool exploded" });
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.error).toBe("executeTool exploded");
            });

            it("stringifies a non-Error executeTool rejection (not aborted) via the outer catch-all", async () => {
                vi.mocked(aggregateTools).mockResolvedValue(toolAggregation());
                 
                vi.mocked(executeTool).mockRejectedValue("raw tool rejection");
                vi.mocked(forwardGeneration).mockImplementation(
                    forwardOk({
                        toolCalls: [{ id: "call-1", name: "srv__weather", arguments: "{}" }],
                        finishReason: "tool_calls",
                    }),
                );
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), {
                    ...BASE_CHAT_INPUT,
                    enabled_mcp_server_ids: ["srv-1"],
                });
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toEqual({ message: "raw tool rejection" });
                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.error).toBe("raw tool rejection");
            });

            it("routes a broken response.body reader through the outer catch-all instead of crashing the stream", async () => {
                vi.mocked(forwardGeneration).mockImplementation(async (_user, _cap, _body, opts = {}) => {
                    opts.onStreamDelta?.({ content: "", reasoning: "" });
                    opts.onComplete?.({ content: "won't get here", reasoning: "", finishReason: "stop" });
                    const brokenBody = new ReadableStream<Uint8Array>({
                        pull() {
                            throw new Error("upstream socket reset");
                        },
                    });
                    return { logId: "log-broken", response: new Response(brokenBody, { status: 200 }) };
                });
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);
                const text = await drain(res);
                const events = parseSseEvents(text);
                expect(events.find((e) => e.event === "loom_error")?.data).toMatchObject({
                    message: expect.stringContaining("upstream socket reset"),
                });
            });

            it("tears down cleanly (no loom_error, partial content persisted) when the client cancels the stream mid-request", async () => {
                let releaseGate!: () => void;
                const gate = new Promise<void>((resolve) => {
                    releaseGate = resolve;
                });
                vi.mocked(forwardGeneration).mockImplementation(async (_user, _cap, _body, opts = {}) => {
                    opts.onStreamDelta?.({ content: "partial", reasoning: "" });
                    // Suspend here so the test can cancel the client-facing
                    // stream WHILE this call is still in flight — mirrors a
                    // real client disconnect racing an open upstream fetch.
                    await gate;
                    opts.onComplete?.({ content: "partial", reasoning: "", finishReason: "stop" });
                    return { logId: "log-cancelled", response: new Response("data: x\n\ndata: [DONE]\n\n", { status: 200 }) };
                });
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);

                // Trip the ReadableStream's `cancel()` underlying-source
                // callback, which flips `abortController.signal.aborted`.
                await res.body!.cancel();
                releaseGate();
                // Give the now-unblocked orchestrator time to run its
                // (synchronous, better-sqlite3) persistence + cleanup.
                await new Promise((resolve) => setTimeout(resolve, 50));

                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([{ type: "text", text: "partial" }]);
                // Client-disconnect is NOT an error condition — no
                // `error` column set, unlike every other failure branch.
                expect(assistantRow.error).toBeNull();
            });

            it("routes the outer catch-all's aborted branch (not the non-aborted loom_error branch) when disconnect races a mid-pipe upstream failure", async () => {
                let releaseGate!: () => void;
                const gate = new Promise<void>((resolve) => {
                    releaseGate = resolve;
                });
                vi.mocked(forwardGeneration).mockImplementation(async (_user, _cap, _body, opts = {}) => {
                    opts.onStreamDelta?.({ content: "partial", reasoning: "" });
                    opts.onComplete?.({ content: "partial", reasoning: "", finishReason: "stop" });
                    // Unlike the broken-reader outer-catch test above,
                    // this body only fails AFTER the test has a chance
                    // to cancel the client-facing stream first — so the
                    // throw surfaces to the outer catch while
                    // `abortController.signal.aborted` is already true,
                    // exercising the *aborted* branch of that catch
                    // (distinct from the non-aborted `loom_error` one).
                    const gatedBody = new ReadableStream<Uint8Array>({
                        async pull() {
                            await gate;
                            throw new Error("upstream socket reset mid-pipe");
                        },
                    });
                    return { logId: "log-mid-pipe-abort", response: new Response(gatedBody, { status: 200 }) };
                });
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);

                await res.body!.cancel();
                releaseGate();
                await new Promise((resolve) => setTimeout(resolve, 50));

                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([{ type: "text", text: "partial" }]);
                expect(assistantRow.error).toBeNull();
            });

            it("routes the inner catch's aborted branch (not the non-aborted loom_error branch) when disconnect races forwardGeneration itself rejecting", async () => {
                let releaseGate!: () => void;
                const gate = new Promise<void>((resolve) => {
                    releaseGate = resolve;
                });
                vi.mocked(forwardGeneration).mockImplementation(async (_user, _cap, _body, opts = {}) => {
                    opts.onStreamDelta?.({ content: "partial", reasoning: "" });
                    // Suspend the forwardGeneration call itself (not its
                    // response body this time) so the client can cancel
                    // while THIS await is in flight, then have it reject
                    // — exercising the inner try/catch's aborted branch
                    // rather than its non-aborted loom_error sibling.
                    await gate;
                    throw new Error("fetch aborted by signal");
                });
                const user = seedUser();
                const res = await sendPlaygroundChat(toSessionUser(user), BASE_CHAT_INPUT);

                await res.body!.cancel();
                releaseGate();
                await new Promise((resolve) => setTimeout(resolve, 50));

                const conversationId = res.headers.get("X-Conversation-ID")!;
                const assistantId = res.headers.get("X-Message-ID")!;
                const assistantRow = activeMessages(conversationId).find((m) => m.id === assistantId)!;
                expect(assistantRow.content).toEqual([{ type: "text", text: "partial" }]);
                expect(assistantRow.error).toBeNull();
            });
        });
    });
});
