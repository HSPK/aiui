import "server-only";
import type { UpstreamApiVariant, VariantContext } from "../api-variants";
import { persistImageArtifacts } from "./artifacts";
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

        // Image responses can carry MB-sized base64 blobs per entry —
        // persisting those verbatim into the JSON column would bloat
        // the DB and crash the log JSON viewer. We persist them to
        // disk under data/log-artifacts/<logId>/ and rewrite the LOG
        // COPY of `normalized.data[]` so each entry references a
        // stable `/api/logs/.../images/<idx>` URL instead. The
        // unmodified `parsed.normalized` (with b64_json intact) is
        // still forwarded to the API caller so client playgrounds
        // keep working.
        let logNormalized: Record<string, unknown> = parsed.normalized;
        if (ctx.capability.id === "image") {
            try {
                logNormalized = structuredClone(parsed.normalized);
                await persistImageArtifacts(logId, logNormalized);
            } catch (err) {
                console.error("[loom] persistImageArtifacts failed:", err);
                logNormalized = parsed.normalized;
            }
        }

        completeLog(logId, {
            status: "completed",
            output: parsed.output,
            generation: logNormalized,
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
