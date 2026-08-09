import "server-only";
import type { UpstreamApiVariant, VariantContext } from "../api-variants";
import type { Model } from "../db/schema";
import { HttpError } from "../response";
import { completeLog } from "./log";
import type { ForwardGenerationOpts, ForwardResult } from "./types";

// Shared stateless encoder for the per-chunk re-emission. The decoder
// stays per-stream because it accumulates partial multi-byte chars
// across `stream: true` calls.
const STREAM_ENCODER = new TextEncoder();

/**
 * Streaming branch of forwardGeneration. Transcodes whatever the
 * upstream variant emits into chat-completion-shaped SSE so the
 * user-facing API is uniform regardless of upstream variant
 * (chat.completions, responses, …).
 *
 * Per-chunk responsibilities:
 *   - text deltas → accumulate + forward + record TTFT
 *   - tool_call deltas → accumulate by streaming index, forward as
 *     OpenAI-shaped `delta.tool_calls`
 *   - usage / id / model / system_fingerprint → propagate to the
 *     merged terminal log entry
 *
 * On flush: emit a terminal stop chunk + [DONE], persist the merged
 * response in canonical chat-completion shape, and surface the
 * assembled tool_calls + finish_reason via opts.onComplete so the
 * playground orchestrator can drive its tool-execution loop.
 */
export function handleStream({
    upstream,
    variant,
    ctx,
    opts,
    started,
    logId,
    model,
}: {
    upstream: Response;
    variant: UpstreamApiVariant;
    ctx: VariantContext;
    opts: ForwardGenerationOpts;
    started: number;
    logId: string;
    model: Model;
}): ForwardResult {
    if (!upstream.body) {
        completeLog(logId, {
            status: "failed",
            reason: "Upstream returned empty stream",
            totalLatencyMs: Date.now() - started,
        });
        throw new HttpError("Upstream returned empty stream", 502);
    }

    let accumContent = "";
    let accumReasoning = "";
    let usage: Record<string, unknown> | undefined;
    let streamModel: string | undefined;
    let streamId: string | undefined;
    let systemFingerprint: string | undefined;
    let finishReason: string | null = null;
    /** Set by `parseStreamChunk` when the upstream emitted a terminal
     *  failure event mid-stream (HTTP status still 200, e.g.
     *  `/v1/responses` `response.failed`). Read by `finalize()` so
     *  the log row's status reflects the actual outcome. */
    let streamError: string | null = null;
    let buf = "";
    let firstTokenMs: number | null = null;

    // Tool-call accumulator keyed by streaming `index`. OpenAI streams
    // tool calls as `{index, id, function:{name, arguments(_delta)}}` —
    // we concatenate `arguments` per-index across chunks.
    const toolAcc = new Map<number, { id?: string; name?: string; arguments: string }>();

    const decoder = new TextDecoder();
    const createdAt = Math.floor(started / 1000);

    // Single-shot terminal log writer. Must be called exactly once per
    // stream; the `completed` flag dedups so flush() and the
    // cancel/error wrapper can't double-write. Without this guard the
    // `generation_logs` row would either stay at "pending" forever
    // (cancel path skipped) or get overwritten (both paths fired).
    let completed = false;
    const finalize = (
        status: "completed" | "failed",
        reason: string | null,
        closingReasonFinal: string,
    ): void => {
        if (completed) return;
        completed = true;

        const orderedToolCalls = Array.from(toolAcc.entries())
            .sort(([a], [b]) => a - b)
            .map(([, v]) => ({
                id: v.id ?? "",
                name: v.name ?? "",
                arguments: v.arguments,
            }))
            .filter((tc) => tc.name);

        const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
        const message: Record<string, unknown> = { role: "assistant", content: accumContent };
        if (accumReasoning) message.reasoning_content = accumReasoning;
        if (orderedToolCalls.length > 0) {
            message.tool_calls = orderedToolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
            }));
        }
        const mergedResponse: Record<string, unknown> = {
            id: streamId ?? logId,
            object: "chat.completion",
            created: createdAt,
            model: streamModel ?? model.upstreamModelId,
            choices: [{ index: 0, message, finish_reason: closingReasonFinal }],
        };
        if (systemFingerprint) mergedResponse.system_fingerprint = systemFingerprint;
        if (usage) mergedResponse.usage = usage;

        completeLog(logId, {
            status,
            reason,
            output: accumContent || null,
            generation: mergedResponse,
            promptTokens: u?.prompt_tokens ?? null,
            completionTokens: u?.completion_tokens ?? null,
            totalTokens: u?.total_tokens ?? null,
            firstTokenLatencyMs: firstTokenMs,
            totalLatencyMs: Date.now() - started,
        });
    };

    const emitChunk = (
        controller: TransformStreamDefaultController<Uint8Array>,
        delta: {
            content?: string;
            reasoning?: string;
            toolCalls?: NonNullable<ReturnType<UpstreamApiVariant["parseStreamChunk"]>>["toolCalls"];
        },
        usagePayload?: Record<string, unknown>,
        chunkFinishReason: string | null = null,
    ) => {
        const messageDelta: Record<string, unknown> = {};
        if (delta.content) messageDelta.content = delta.content;
        if (delta.reasoning) messageDelta.reasoning_content = delta.reasoning;
        if (delta.toolCalls && delta.toolCalls.length > 0) {
            messageDelta.tool_calls = delta.toolCalls.map((tc) => ({
                index: tc.index,
                id: tc.id,
                type: "function" as const,
                function: {
                    name: tc.name,
                    arguments: tc.argumentsDelta,
                },
            }));
        }
        const chunkObj: Record<string, unknown> = {
            id: streamId ?? logId,
            object: "chat.completion.chunk",
            created: createdAt,
            model: streamModel ?? model.upstreamModelId,
            choices: [
                {
                    index: 0,
                    delta: messageDelta,
                    finish_reason: chunkFinishReason,
                },
            ],
        };
        if (systemFingerprint) chunkObj.system_fingerprint = systemFingerprint;
        if (usagePayload) chunkObj.usage = usagePayload;
        controller.enqueue(STREAM_ENCODER.encode(`data: ${JSON.stringify(chunkObj)}\n\n`));
    };

    const transformer = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            buf += decoder.decode(chunk, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data || data === "[DONE]") continue;

                let json: unknown;
                try {
                    json = JSON.parse(data);
                } catch {
                    continue; // mid-stream parse error
                }

                const delta = variant.parseStreamChunk(json, ctx);
                if (!delta) continue;

                if (delta.id && !streamId) streamId = delta.id;
                if (delta.model) streamModel = delta.model;
                if (delta.systemFingerprint) systemFingerprint = delta.systemFingerprint;
                if (delta.usage) usage = delta.usage;
                if (delta.finishReason) finishReason = delta.finishReason;
                // Variant-reported terminal failure (HTTP 200 but
                // upstream emitted response.failed / .incomplete /
                // similar mid-stream). Captured for finalize() so the
                // log row reflects status="failed", not "completed".
                if (delta.error?.reason) streamError = delta.error.reason;

                if (delta.toolCalls && delta.toolCalls.length > 0) {
                    for (const tc of delta.toolCalls) {
                        const slot = toolAcc.get(tc.index) ?? { arguments: "" };
                        if (tc.id) slot.id = tc.id;
                        if (tc.name) slot.name = tc.name;
                        if (tc.argumentsDelta) slot.arguments += tc.argumentsDelta;
                        toolAcc.set(tc.index, slot);
                    }
                    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
                }

                const hasText = !!(delta.content || delta.reasoning);
                if (hasText) {
                    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
                    if (delta.content) accumContent += delta.content;
                    if (delta.reasoning) accumReasoning += delta.reasoning;
                    opts.onStreamDelta?.({
                        content: delta.content ?? "",
                        reasoning: delta.reasoning ?? "",
                    });
                }
                if (hasText || (delta.toolCalls && delta.toolCalls.length > 0)) {
                    emitChunk(controller, {
                        content: delta.content,
                        reasoning: delta.reasoning,
                        toolCalls: delta.toolCalls,
                    });
                }
            }
        },
        flush(controller) {
            // Assemble fully-merged tool_calls for both the log and the
            // onComplete callback. Sorted by index to keep deterministic
            // ordering across attempts.
            const orderedToolCalls = Array.from(toolAcc.entries())
                .sort(([a], [b]) => a - b)
                .map(([, v]) => ({
                    id: v.id ?? "",
                    name: v.name ?? "",
                    arguments: v.arguments,
                }))
                .filter((tc) => tc.name);

            const closingReason = finishReason ?? (orderedToolCalls.length > 0 ? "tool_calls" : "stop");
            // Terminal stop chunk (carries final usage if known) + [DONE].
            emitChunk(controller, {}, usage, closingReason);
            controller.enqueue(STREAM_ENCODER.encode("data: [DONE]\n\n"));

            // If a variant set `streamError` (e.g. response.failed
            // mid-stream), persist the log row as failed — otherwise
            // a 200-status-but-failed upstream would be indistinguishable
            // from a clean completion in `generation_logs`.
            if (streamError) {
                finalize("failed", streamError, closingReason);
            } else {
                finalize("completed", null, closingReason);
            }

            opts.onComplete?.({
                content: accumContent,
                reasoning: accumReasoning,
                usage,
                toolCalls: orderedToolCalls.length > 0 ? orderedToolCalls : undefined,
                finishReason: closingReason,
                // Propagate streamError up to the orchestrator so it
                // sets `lastError`, emits `loom_error` to the FE, and
                // the assistant DB row persists with `error:` — without
                // this the DB log says "failed" but the chat UI shows
                // a normal green bubble with no retry button.
                error: streamError ?? undefined,
            });
        },
    });

    const piped = upstream.body.pipeThrough(transformer);

    // Wrap the piped stream so we can observe ABNORMAL termination
    // (consumer cancel — FE disconnect, proxy hangup — or upstream
    // error mid-stream). The native TransformStream's `flush()` only
    // fires on normal close, so without this wrapper the
    // `generation_logs` row stays at "pending" forever on abort.
    // The wrapper is a thin reader-passthrough; cancel propagates
    // upstream so the in-flight fetch tears down too.
    //
    // Held across `start`/`cancel` because the reader — not the stream —
    // is what a cancel has to go through once the lock is taken.
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const observed = new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = piped.getReader();
            activeReader = reader;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    controller.enqueue(value);
                }
                controller.close();
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                finalize("failed", reason, finishReason ?? "stop");
                controller.error(err);
            } finally {
                activeReader = null;
                reader.releaseLock();
            }
        },
        cancel(reason) {
            // Consumer gave up. The TransformStream's `flush()` will
            // NOT fire — capture the partial state into the log row
            // so it doesn't sit at "pending" forever.
            const msg = reason instanceof Error
                ? reason.message
                : (typeof reason === "string" && reason)
                    ? reason
                    : "client cancelled";
            finalize("failed", msg, finishReason ?? "stop");
            // Cancel through the READER that owns the lock. `piped.cancel()`
            // throws `TypeError: Invalid state: ReadableStream is locked`
            // whenever a read is in flight (i.e. the normal case), so the
            // cancellation never reached the upstream fetch and the provider
            // connection leaked — still streaming, still billing — after the
            // client had already disconnected.
            const reader = activeReader;
            return reader ? reader.cancel(reason) : piped.cancel(reason);
        },
    });

    return {
        response: new Response(observed, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        }),
        logId,
    };
}
