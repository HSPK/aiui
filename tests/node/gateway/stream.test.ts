// Direct unit tests for `handleStream` — the SSE transcoding branch of
// forwardGeneration. Uses a hand-written pass-through variant whose
// `parseStreamChunk` returns its input verbatim (already shaped as
// `NormalizedStreamDelta`), so every test event we feed IS the delta
// stream.ts sees — full determinism over accumulation / TTFT / tool-call
// assembly without depending on any real variant's parsing logic (that's
// covered by tests/node/upstream/variant-*.test.ts, not this file).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { handleStream } from "@/lib/server/gateway/stream";
import { startLog } from "@/lib/server/gateway/log";
import type { UpstreamApiVariant, VariantContext, NormalizedStreamDelta } from "@/lib/server/api-variants";
import type { CapabilityHandler } from "@/lib/server/capabilities";
import type { Model } from "@/lib/server/db/schema";
import { resetDb, seedUser } from "@/tests/helpers/db";
import { chunkedStream, erroringStream, parseSseEvents, readAllText } from "./helpers";

const passthroughVariant: UpstreamApiVariant = {
    id: "chat.completions",
    capability: "chat",
    path: "/chat/completions",
    supportsStreaming: true,
    parseResponse(): never {
        throw new Error("parseResponse not exercised by the streaming suite");
    },
    parseStreamChunk(json) {
        return json as NormalizedStreamDelta | null;
    },
};

const fakeModel = { upstreamModelId: "gpt-4o-mini" } as unknown as Model;
const fakeCtx: VariantContext = {
    provider: {} as VariantContext["provider"],
    model: fakeModel,
    meta: null,
    capability: { id: "chat" } as CapabilityHandler,
    stream: true,
};

/** Build an SSE ReadableStream directly from NormalizedStreamDelta-shaped
 *  events (our passthroughVariant treats them as-is), one event per chunk. */
function deltaStream(events: Array<NormalizedStreamDelta | null | "[DONE]">): ReadableStream<Uint8Array> {
    const lines = events.map((e) => `data: ${e === "[DONE]" ? "[DONE]" : JSON.stringify(e)}\n\n`);
    return chunkedStream(lines);
}

function getLogRow(id: string) {
    const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, id)).get();
    if (!row) throw new Error(`log row ${id} not found`);
    return row;
}

/** A fresh, real generation_logs row (status=pending) so completeLog()'s
 *  UPDATE has something to land in and we can assert on it afterwards. */
function freshLogId(): string {
    const user = seedUser();
    return startLog({
        userId: user.id,
        modelName: "gpt-4o-mini",
        capability: "chat",
        requestBody: {},
        inputSummary: null,
    });
}

describe("handleStream", () => {
    beforeEach(() => resetDb());

    it("throws synchronously (and marks the log failed) when the upstream response has no body", () => {
        const logId = freshLogId();
        const upstream = new Response(null, { status: 200 });
        expect(() =>
            handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel }),
        ).toThrow(/Upstream returned empty stream/);
        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("Upstream returned empty stream");
    });

    it("transcodes text deltas into chat-completion-shaped SSE, ending with a terminal chunk + [DONE]", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([
                { content: "Hel", reasoning: "" },
                { content: "lo", reasoning: "" },
                { content: "", reasoning: "", finishReason: "stop", usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
            ]),
            { status: 200 },
        );
        const started = Date.now();
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started, logId, model: fakeModel });

        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
        const text = await response.text();
        const events = parseSseEvents(text);
        // 2 content chunks + 1 terminal chunk (the usage/finishReason-only
        // event carries no text/toolCalls of its own, so it is captured
        // into the outer state but never echoed as its own chunk).
        expect(events).toHaveLength(3);
        expect(events[0].object).toBe("chat.completion.chunk");
        expect((events[0] as any).choices[0].delta.content).toBe("Hel");
        expect((events[1] as any).choices[0].delta.content).toBe("lo");
        const terminal = events[2] as any;
        expect(terminal.choices[0].delta).toEqual({});
        expect(terminal.choices[0].finish_reason).toBe("stop");
        expect(terminal.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
        expect(text.trim().endsWith("data: [DONE]")).toBe(true);

        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        expect(row.output).toBe("Hello");
        expect(row.promptTokens).toBe(5);
        expect(row.completionTokens).toBe(2);
        expect(row.totalTokens).toBe(7);
        expect(row.firstTokenLatencyMs).toBeGreaterThanOrEqual(0);
        expect(row.totalLatencyMs).toBeGreaterThanOrEqual(0);
        const generation = row.generation as any;
        expect(generation.choices[0].message.content).toBe("Hello");
        expect(generation.choices[0].finish_reason).toBe("stop");
    });

    it("falls back to logId for the chunk id and model.upstreamModelId for the chunk model when the variant never supplies them", async () => {
        const logId = freshLogId();
        const upstream = new Response(deltaStream([{ content: "hi", reasoning: "" }]), { status: 200 });
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        const events = parseSseEvents(await response.text());
        expect((events[0] as any).id).toBe(logId);
        expect((events[0] as any).model).toBe("gpt-4o-mini");
    });

    it("uses the variant-reported id/model once seen, and keeps re-emitting system_fingerprint on every later chunk", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([
                { content: "", reasoning: "", id: "resp_abc", model: "gpt-4o-2024", systemFingerprint: "fp_1" },
                { content: "hi", reasoning: "" },
            ]),
            { status: 200 },
        );
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        const events = parseSseEvents(await response.text());
        // First event carried no text/toolCalls -> not echoed as its own
        // chunk, but its id/model/fingerprint are captured for later ones.
        expect(events).toHaveLength(2); // "hi" chunk + terminal chunk
        expect((events[0] as any).id).toBe("resp_abc");
        expect((events[0] as any).model).toBe("gpt-4o-2024");
        expect((events[0] as any).system_fingerprint).toBe("fp_1");
        expect((events[1] as any).system_fingerprint).toBe("fp_1");
    });

    it("captures TTFT on the first delta bearing text, not on an earlier lifecycle-only event", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([
                { content: "", reasoning: "", id: "resp_1" }, // lifecycle only, no text
                { content: "first token", reasoning: "" },
            ]),
            { status: 200 },
        );
        const started = Date.now();
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started, logId, model: fakeModel });
        await response.text();
        const row = getLogRow(logId);
        expect(row.firstTokenLatencyMs).not.toBeNull();
        expect(row.firstTokenLatencyMs as number).toBeGreaterThanOrEqual(0);
    });

    it("assembles tool calls across multiple deltas by streaming index, sorted in the final order, dropping nameless partials", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([
                // index 1 arrives before index 0 on the wire.
                { content: "", reasoning: "", toolCalls: [{ index: 1, id: "call_2", name: "get_time" }] },
                { content: "", reasoning: "", toolCalls: [{ index: 1, argumentsDelta: "{}" }] },
                { content: "", reasoning: "", toolCalls: [{ index: 0, id: "call_1", name: "get_weather", argumentsDelta: '{"loc":' }] },
                { content: "", reasoning: "", toolCalls: [{ index: 0, argumentsDelta: '"NYC"}' }] },
                // Nameless partial at an unused index — must be dropped
                // from the final assembled list (filter on tc.name).
                { content: "", reasoning: "", toolCalls: [{ index: 2, argumentsDelta: "orphan" }] },
                { content: "", reasoning: "", finishReason: "tool_calls" },
            ]),
            { status: 200 },
        );
        const onComplete = vi.fn();
        const { response } = handleStream({
            upstream, variant: passthroughVariant, ctx: fakeCtx, opts: { onComplete }, started: Date.now(), logId, model: fakeModel,
        });
        await response.text();

        const row = getLogRow(logId);
        const generation = row.generation as any;
        expect(generation.choices[0].message.tool_calls).toEqual([
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"loc":"NYC"}' } },
            { id: "call_2", type: "function", function: { name: "get_time", arguments: "{}" } },
        ]);
        expect(generation.choices[0].finish_reason).toBe("tool_calls");

        expect(onComplete).toHaveBeenCalledTimes(1);
        const info = onComplete.mock.calls[0][0];
        expect(info.toolCalls).toEqual([
            { id: "call_1", name: "get_weather", arguments: '{"loc":"NYC"}' },
            { id: "call_2", name: "get_time", arguments: "{}" },
        ]);
        expect(info.finishReason).toBe("tool_calls");
    });

    it("derives finish_reason 'tool_calls' even when the upstream never sends an explicit finishReason", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([{ content: "", reasoning: "", toolCalls: [{ index: 0, id: "call_1", name: "f" }] }]),
            { status: 200 },
        );
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        await response.text();
        const row = getLogRow(logId);
        expect((row.generation as any).choices[0].finish_reason).toBe("tool_calls");
    });

    it("defaults finish_reason to 'stop' when neither finishReason nor tool calls are present", async () => {
        const logId = freshLogId();
        const upstream = new Response(deltaStream([{ content: "hi", reasoning: "" }]), { status: 200 });
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        await response.text();
        const row = getLogRow(logId);
        expect((row.generation as any).choices[0].finish_reason).toBe("stop");
    });

    it("accumulates reasoning content separately and persists it on the message", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([
                { content: "", reasoning: "thinking..." },
                { content: "answer", reasoning: "" },
            ]),
            { status: 200 },
        );
        const onStreamDelta = vi.fn();
        const { response } = handleStream({
            upstream, variant: passthroughVariant, ctx: fakeCtx, opts: { onStreamDelta }, started: Date.now(), logId, model: fakeModel,
        });
        await response.text();
        const row = getLogRow(logId);
        expect((row.generation as any).choices[0].message.reasoning_content).toBe("thinking...");
        expect((row.generation as any).choices[0].message.content).toBe("answer");
        expect(onStreamDelta).toHaveBeenCalledWith({ content: "", reasoning: "thinking..." });
        expect(onStreamDelta).toHaveBeenCalledWith({ content: "answer", reasoning: "" });
    });

    it("promotes a mid-stream variant-reported error to a failed log row and onComplete.error, while still forwarding the partial content", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            deltaStream([{ content: "partial", reasoning: "", error: { reason: "content_filter" } }]),
            { status: 200 },
        );
        const onComplete = vi.fn();
        const { response } = handleStream({
            upstream, variant: passthroughVariant, ctx: fakeCtx, opts: { onComplete }, started: Date.now(), logId, model: fakeModel,
        });
        const text = await response.text();
        const events = parseSseEvents(text);
        expect((events[0] as any).choices[0].delta.content).toBe("partial");

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("content_filter");
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.calls[0][0].error).toBe("content_filter");
    });

    it("silently ignores unparsable mid-stream JSON and non-data SSE lines without breaking the stream", async () => {
        const logId = freshLogId();
        const raw = [
            ": this is an SSE comment line, not data\n\n",
            "data: not-json-at-all{{{\n\n",
            'data: {"content":"ok","reasoning":""}\n\n',
            "\n",
            "data: [DONE]\n\n",
        ];
        const upstream = new Response(chunkedStream(raw), { status: 200 });
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        const text = await response.text();
        const events = parseSseEvents(text);
        expect(events).toHaveLength(2); // "ok" chunk + terminal chunk
        expect((events[0] as any).choices[0].delta.content).toBe("ok");
        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        expect(row.output).toBe("ok");
    });

    it("reassembles a single SSE data: line split across two physical network chunks", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            chunkedStream(['data: {"content":"Hel', 'lo","reasoning":""}\n\n', "data: [DONE]\n\n"]),
            { status: 200 },
        );
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        await response.text();
        const row = getLogRow(logId);
        expect(row.output).toBe("Hello");
    });

    // Regression coverage for the fix at lib/server/gateway/stream.ts:297-335.
    // `observed`'s `cancel(reason)` handler now cancels through `activeReader`
    // (the reader `start()` acquired on `piped` and holds for the wrapper's
    // whole lifetime) instead of calling `piped.cancel(reason)` directly.
    // Cancelling a *locked* stream directly used to reject with `TypeError:
    // Invalid state: ReadableStream is locked` — which is the ordinary case
    // any time cancellation happens while a read is in flight (i.e. a client
    // disconnecting while still awaiting more upstream data) — silently
    // preventing cancellation from ever reaching the upstream fetch/connection.
    // This test asserts cancellation resolves cleanly (no TypeError) AND
    // actually propagates all the way to the underlying upstream source's own
    // `cancel()` — proving the in-flight fetch really tears down, not just
    // that the client-facing promise settles.
    it("cancelling the client response stream propagates to the upstream source without throwing", async () => {
        const logId = freshLogId();
        const encoder = new TextEncoder();
        let sourceCancelReason: unknown;
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: {"content":"a","reasoning":""}\n\n'));
                // Deliberately never closes — simulates an in-progress upstream
                // still awaiting more data when the client disconnects, so
                // `activeReader` is still held (non-null) at cancel time.
            },
            cancel(reason) {
                sourceCancelReason = reason;
            },
        });
        const upstream = new Response(source, { status: 200 });
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });

        const reader = response.body!.getReader();
        await reader.read();

        // No TypeError: cancelling while a read is in flight resolves cleanly.
        await expect(reader.cancel("client disconnected")).resolves.toBeUndefined();

        // Propagation actually reached the underlying upstream source — not
        // just that the client-facing cancel() promise settled.
        expect(sourceCancelReason).toBe("client disconnected");
        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("client disconnected");
    });

    // The `activeReader === null` (`piped.cancel(reason)`) side of the ternary
    // at stream.ts:334-335 is a defensive fallback that is NOT reachable via
    // any legitimate external cancel call with the current code shape:
    // `activeReader` is assigned synchronously in `start()`'s prelude (before
    // its first `await`), so it is already non-null by the time `new
    // ReadableStream(...)` returns control to any caller; and it is only ever
    // reset to `null` in `finally`, which — being a `finally` — always runs
    // strictly AFTER `controller.close()`/`controller.error()` has already
    // flipped `observed`'s own state away from "readable" in the same
    // try/catch. Per the WHATWG `ReadableStreamCancel` algorithm, cancelling
    // an already closed/errored stream short-circuits (resolves/rejects
    // immediately) BEFORE ever invoking the custom `cancel()` handler body —
    // so by the time an external caller could possibly observe
    // `activeReader === null`, the stream is already closed and the spec
    // itself prevents that call from reaching this handler at all. This was
    // verified empirically (a plain ReadableStream's custom `cancel()` is
    // never invoked when `.cancel()` is called after the stream has already
    // closed) as well as by inspecting stream.ts's exact control flow. The
    // test below instead documents and pins down that closed-stream
    // short-circuit: cancelling *after* the stream has already completed
    // naturally (activeReader already nulled) is a harmless, TypeError-free
    // no-op that does NOT re-invoke finalize()/re-touch the log row — i.e.
    // there is no way to observe the `piped.cancel(reason)` branch from the
    // outside, but there's also no way to break anything by trying.
    it("cancelling after the stream has already completed naturally (activeReader already null) is a harmless no-op", async () => {
        const logId = freshLogId();
        const upstream = new Response(deltaStream([{ content: "x", reasoning: "" }]), { status: 200 });
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });

        // Fully drain the stream via our OWN reader so start()'s internal read
        // loop completes (controller.close() already ran and `finally` has
        // already nulled activeReader), then explicitly release our reader's
        // lock — `response.text()` acquires its own internal reader and
        // never releases it, which would leave `observed` "locked" forever
        // and make ANY subsequent direct `.cancel()` throw for an unrelated
        // reason (locked, not closed). Releasing our own reader is what
        // makes `observed` genuinely closed AND unlocked, matching the
        // exact state `piped.cancel(reason)` is written for.
        const reader = response.body!.getReader();
        for (;;) {
            const { done } = await reader.read();
            if (done) break;
        }
        reader.releaseLock();
        const rowAfterCompletion = getLogRow(logId);
        expect(rowAfterCompletion.status).toBe("completed");

        // Cancelling the already-closed, now-unlocked stream must not throw
        // and must not clobber the already-terminal "completed" log row
        // with "failed".
        await expect(response.body!.cancel("too late")).resolves.toBeUndefined();
        const rowAfterCancel = getLogRow(logId);
        expect(rowAfterCancel.status).toBe("completed");
    });

    it("finalizes the log as failed when the upstream stream errors mid-read", async () => {
        const logId = freshLogId();
        const upstream = new Response(
            erroringStream(['data: {"content":"a","reasoning":""}\n\n'], new Error("socket hang up")),
            { status: 200 },
        );
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });

        await expect(readAllText(response.body!)).rejects.toThrow(/socket hang up/);

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("socket hang up");
    });

    it("the terminal completeLog write only ever happens once even if flush + an error both race (dedup guard)", async () => {
        // A clean, fully-drained stream should finalize exactly once —
        // reading the (already fully consumed) body again must not
        // throw or double-write.
        const logId = freshLogId();
        const upstream = new Response(deltaStream([{ content: "x", reasoning: "" }]), { status: 200 });
        const { response } = handleStream({ upstream, variant: passthroughVariant, ctx: fakeCtx, opts: {}, started: Date.now(), logId, model: fakeModel });
        await response.text();
        const row1 = getLogRow(logId);
        expect(row1.status).toBe("completed");
        const latencyAfterFirstRead = row1.totalLatencyMs;
        // Reading again (no-op — stream already closed) must not change anything.
        await new Promise((r) => setTimeout(r, 5));
        const row2 = getLogRow(logId);
        expect(row2.totalLatencyMs).toBe(latencyAfterFirstRead);
    });
});
