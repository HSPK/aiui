import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { StreamClient } from "@/components/playground/chat/stream-client";
import type { StreamCallbacks, StreamConfig } from "@/components/playground/chat/types";

/** A reader stub that yields one `Uint8Array` chunk per call, then `done`.
 *  `cancel`/`releaseLock` are spies so tests can assert cleanup. */
function makeReader(chunks: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    return {
        read: vi.fn(async () => {
            if (i < chunks.length) {
                const value = encoder.encode(chunks[i]);
                i += 1;
                return { value, done: false };
            }
            return { value: undefined, done: true };
        }),
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn(() => undefined),
    };
}

type FakeResponseInit = {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    bodyText?: string;
    chunks?: string[];
    noBody?: boolean;
};

function fakeResponse(init: FakeResponseInit = {}) {
    const {
        ok = true,
        status = 200,
        statusText = "OK",
        headers = {},
        bodyText = "",
        chunks = [],
        noBody = false,
    } = init;
    const reader = makeReader(chunks);
    return {
        response: {
            ok,
            status,
            statusText,
            headers: new Headers(headers),
            text: vi.fn(async () => bodyText),
            body: noBody ? null : { getReader: () => reader },
        } as unknown as Response,
        reader,
    };
}

function makeCallbacks(): {
    onContent: Mock<StreamCallbacks["onContent"]>;
    onToolEvent: Mock<StreamCallbacks["onToolEvent"]>;
    onComplete: Mock<StreamCallbacks["onComplete"]>;
    onError: Mock<StreamCallbacks["onError"]>;
} {
    return {
        onContent: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
    };
}

const baseConfig: StreamConfig = {
    conversationId: "conv_1",
    model: "gpt-4o",
    content: "Hello there",
    userMessageId: "user_msg_1",
    assistantMessageId: "assistant_msg_1",
};

describe("StreamClient", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe("request construction", () => {
        it("POSTs to /api/playground/chat with credentials, JSON body and an abort signal", async () => {
            const { response } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();

            await client.stream(baseConfig, makeCallbacks());

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/playground/chat");
            expect(init.method).toBe("POST");
            expect(init.credentials).toBe("include");
            expect(init.headers).toEqual({ "Content-Type": "application/json" });
            expect(init.signal).toBeInstanceOf(AbortSignal);

            const body = JSON.parse(init.body);
            expect(body).toMatchObject({
                conversation_id: "conv_1",
                model: "gpt-4o",
                content: "Hello there",
                user_message_id: "user_msg_1",
                assistant_message_id: "assistant_msg_1",
                parent_message_id: null,
            });
            expect(body).not.toHaveProperty("enabled_mcp_server_ids");
        });

        it("defaults parent_message_id to null when omitted", async () => {
            const { response } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();

            await client.stream(baseConfig, makeCallbacks());

            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.parent_message_id).toBeNull();
        });

        it("forwards a non-empty enabled_mcp_server_ids list and drops it when empty", async () => {
            const { response: r1 } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValueOnce(r1);
            const client = new StreamClient();
            await client.stream({ ...baseConfig, enabledMcpServerIds: ["github", "fs"] }, makeCallbacks());
            let body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.enabled_mcp_server_ids).toEqual(["github", "fs"]);

            const { response: r2 } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValueOnce(r2);
            await client.stream({ ...baseConfig, enabledMcpServerIds: [] }, makeCallbacks());
            body = JSON.parse(fetchMock.mock.calls[1][1].body);
            expect(body).not.toHaveProperty("enabled_mcp_server_ids");
        });

        it("spreads additionalConfig fields onto the request body", async () => {
            const { response } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();

            await client.stream(
                { ...baseConfig, additionalConfig: { temperature: 0.5, top_p: 0.9 } },
                makeCallbacks()
            );

            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.temperature).toBe(0.5);
            expect(body.top_p).toBe(0.9);
        });
    });

    describe("header-based onComplete", () => {
        it("calls onComplete with X-Message-ID/X-Generation-ID BEFORE checking res.ok", async () => {
            const { response } = fakeResponse({
                ok: false,
                status: 500,
                headers: { "X-Message-ID": "srv_msg_1", "X-Generation-ID": "gen_1" },
                bodyText: "",
                statusText: "Internal Server Error",
            });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).rejects.toThrow();

            expect(callbacks.onComplete).toHaveBeenCalledWith("srv_msg_1", "gen_1");
            expect(callbacks.onError).toHaveBeenCalledTimes(1);
        });

        it("does not call onComplete when neither header is present and no message_meta event streams", async () => {
            const { response } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await client.stream(baseConfig, callbacks);

            expect(callbacks.onComplete).not.toHaveBeenCalled();
        });
    });

    describe("non-ok error message extraction", () => {
        it("uses the envelope's msg field when the error body is JSON", async () => {
            const { response } = fakeResponse({
                ok: false,
                status: 404,
                bodyText: JSON.stringify({ code: -1, msg: "Model not found", data: null }),
            });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).rejects.toThrow("Model not found");
            expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Model not found" }));
        });

        it("falls back to the raw body text when it is not JSON", async () => {
            const { response } = fakeResponse({ ok: false, status: 502, bodyText: "Bad Gateway upstream" });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).rejects.toThrow("Bad Gateway upstream");
        });

        it("falls back to statusText when the body text is empty", async () => {
            const { response } = fakeResponse({ ok: false, status: 500, bodyText: "", statusText: "Server Error" });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).rejects.toThrow("Server Error");
        });
    });

    it("throws 'No response body' when the response has no body", async () => {
        const { response } = fakeResponse({ noBody: true });
        fetchMock.mockResolvedValue(response);
        const client = new StreamClient();
        const callbacks = makeCallbacks();

        await expect(client.stream(baseConfig, callbacks)).rejects.toThrow("No response body");
        expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "No response body" }));
    });

    describe("streaming event dispatch", () => {
        it("dispatches content deltas to onContent", async () => {
            const { response } = fakeResponse({
                chunks: [
                    `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
                    `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
                    "data: [DONE]\n\n",
                ],
            });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await client.stream(baseConfig, callbacks);

            expect(callbacks.onContent).toHaveBeenNthCalledWith(1, "Hello", "");
            expect(callbacks.onContent).toHaveBeenNthCalledWith(2, " world", "");
        });

        it("dispatches message_meta to onComplete with null fallback for missing ids", async () => {
            const { response } = fakeResponse({
                chunks: [
                    `event: loom_message_meta\ndata: ${JSON.stringify({ message_id: "m2" })}\n\n`,
                    "data: [DONE]\n\n",
                ],
            });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await client.stream(baseConfig, callbacks);

            expect(callbacks.onComplete).toHaveBeenCalledWith("m2", null);
        });

        it("dispatches tool_call_delta, tool_result and tool_error to onToolEvent", async () => {
            const { response } = fakeResponse({
                chunks: [
                    `data: ${JSON.stringify({
                        choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search" } }] } }],
                    })}\n\n`,
                    `event: loom_tool_result\ndata: ${JSON.stringify({
                        call_id: "c1",
                        name: "search",
                        content: "3 results",
                        is_error: false,
                    })}\n\n`,
                    `event: loom_tool_error\ndata: ${JSON.stringify({ message: "boom", server_name: "github" })}\n\n`,
                    "data: [DONE]\n\n",
                ],
            });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await client.stream(baseConfig, callbacks);

            expect(callbacks.onToolEvent).toHaveBeenNthCalledWith(1, {
                type: "tool_call_delta",
                call: { index: 0, id: "c1", name: "search", argumentsDelta: undefined },
            });
            expect(callbacks.onToolEvent).toHaveBeenNthCalledWith(2, {
                type: "tool_result",
                result: { call_id: "c1", name: "search", content: "3 results", is_error: false, source: undefined },
            });
            expect(callbacks.onToolEvent).toHaveBeenNthCalledWith(3, {
                type: "tool_error",
                message: "boom",
                serverName: "github",
            });
        });

        it("throws on an error event, calls onError, and still releases the reader", async () => {
            const { response, reader } = fakeResponse({
                chunks: [`event: error\ndata: ${JSON.stringify({ message: "upstream exploded" })}\n\n`],
            });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).rejects.toThrow("upstream exploded");

            expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "upstream exploded" }));
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        });

        it("does not invoke any callback for a bare 'done' event", async () => {
            const { response } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await client.stream(baseConfig, callbacks);

            expect(callbacks.onContent).not.toHaveBeenCalled();
            expect(callbacks.onToolEvent).not.toHaveBeenCalled();
            expect(callbacks.onError).not.toHaveBeenCalled();
        });

        it("releases the reader after a clean completion", async () => {
            const { response, reader } = fakeResponse({ chunks: ["data: [DONE]\n\n"] });
            fetchMock.mockResolvedValue(response);
            const client = new StreamClient();

            await client.stream(baseConfig, makeCallbacks());

            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        });
    });

    describe("AbortError handling", () => {
        it("treats a fetch rejection named AbortError as a clean completion (no onError, no throw)", async () => {
            const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
            fetchMock.mockRejectedValue(abortError);
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).resolves.toBeUndefined();
            expect(callbacks.onError).not.toHaveBeenCalled();
        });

        it("still calls onError and rethrows for non-abort fetch failures", async () => {
            fetchMock.mockRejectedValue(new Error("network down"));
            const client = new StreamClient();
            const callbacks = makeCallbacks();

            await expect(client.stream(baseConfig, callbacks)).rejects.toThrow("network down");
            expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "network down" }));
        });
    });

    describe("abort() / getController()", () => {
        it("returns null before stream() has been called", () => {
            const client = new StreamClient();
            expect(client.getController()).toBeNull();
        });

        it("exposes a live AbortController while streaming and clears it on abort()", async () => {
            let rejectFetch!: (err: unknown) => void;
            fetchMock.mockReturnValue(
                new Promise((_resolve, reject) => {
                    rejectFetch = reject;
                })
            );
            const client = new StreamClient();
            const pending = client.stream(baseConfig, makeCallbacks());

            const controller = client.getController();
            expect(controller).toBeInstanceOf(AbortController);
            expect(controller?.signal.aborted).toBe(false);

            client.abort();
            expect(controller?.signal.aborted).toBe(true);
            expect(client.getController()).toBeNull();

            rejectFetch(Object.assign(new Error("aborted"), { name: "AbortError" }));
            await expect(pending).resolves.toBeUndefined();
        });
    });
});
