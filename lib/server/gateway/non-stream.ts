import "server-only";
import type { UpstreamApiVariant, VariantContext } from "../api-variants";
import { completeLog } from "./log";
import type { ForwardGenerationOpts, ForwardResult } from "./types";

/**
 * Non-streaming branch of forwardGeneration. JSON responses are
 * variant-parsed into canonical chat-completion shape + logged;
 * binary responses are passed through with their content-type. Stays
 * separate from the streaming branch so future variant work (e.g. a
 * non-stream-only embeddings variant) can iterate here without
 * touching the transform pipeline.
 */
export async function handleNonStream({
    upstream,
    variant,
    ctx,
    opts,
    started,
    logId,
}: {
    upstream: Response;
    variant: UpstreamApiVariant;
    ctx: VariantContext;
    opts: ForwardGenerationOpts;
    started: number;
    logId: string;
}): Promise<ForwardResult> {
    const contentType = upstream.headers.get("Content-Type") ?? "";

    if (contentType.startsWith("application/json")) {
        const json = await upstream.json().catch(() => ({}));
        const parsed = variant.parseResponse(json, ctx);
        completeLog(logId, {
            status: "completed",
            output: parsed.output,
            content: parsed.normalized,
            generation: parsed.normalized,
            promptTokens: parsed.promptTokens,
            completionTokens: parsed.completionTokens,
            totalTokens: parsed.totalTokens,
            totalLatencyMs: Date.now() - started,
        });
        opts.onComplete?.({
            content: parsed.output ?? "",
            reasoning: "",
            usage: parsed.normalized.usage as Record<string, unknown> | undefined,
            toolCalls: parsed.toolCalls,
            finishReason: parsed.finishReason,
        });
        return {
            response: new Response(JSON.stringify(parsed.normalized), {
                headers: { "Content-Type": "application/json" },
            }),
            logId,
        };
    }

    // Binary or unknown — log size, pass through.
    const buf = await upstream.arrayBuffer();
    completeLog(logId, {
        status: "completed",
        output: `binary response (${contentType || "unknown"}, ${buf.byteLength} bytes)`,
        totalLatencyMs: Date.now() - started,
    });
    return {
        response: new Response(buf, {
            headers: { "Content-Type": contentType || "application/octet-stream" },
        }),
        logId,
    };
}
