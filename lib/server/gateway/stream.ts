import "server-only";
import type { UpstreamApiVariant, VariantContext } from "../api-variants";
import type { Model } from "../db/schema";
import { HttpError } from "../response";
import { completeLog } from "./log";
import type { ForwardGenerationOpts, ForwardResult } from "./types";

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
    let buf = "";
    let firstTokenMs: number | null = null;

    // Tool-call accumulator keyed by streaming `index`. OpenAI streams
    // tool calls as `{index, id, function:{name, arguments(_delta)}}` —
    // we concatenate `arguments` per-index across chunks.
    const toolAcc = new Map<number, { id?: string; name?: string; arguments: string }>();

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const createdAt = Math.floor(started / 1000);

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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`));
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
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));

            // Persist the merged log entry in canonical chat-completion shape.
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
                choices: [{ index: 0, message, finish_reason: closingReason }],
            };
            if (systemFingerprint) mergedResponse.system_fingerprint = systemFingerprint;
            if (usage) mergedResponse.usage = usage;

            completeLog(logId, {
                status: "completed",
                output: accumContent,
                content: mergedResponse,
                generation: mergedResponse,
                promptTokens: u?.prompt_tokens ?? null,
                completionTokens: u?.completion_tokens ?? null,
                totalTokens: u?.total_tokens ?? null,
                firstTokenLatencyMs: firstTokenMs,
                totalLatencyMs: Date.now() - started,
            });
            opts.onComplete?.({
                content: accumContent,
                reasoning: accumReasoning,
                usage,
                toolCalls: orderedToolCalls.length > 0 ? orderedToolCalls : undefined,
                finishReason: closingReason,
            });
        },
    });

    const piped = upstream.body.pipeThrough(transformer);
    return {
        response: new Response(piped, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        }),
        logId,
    };
}
