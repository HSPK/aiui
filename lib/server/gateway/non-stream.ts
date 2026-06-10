import "server-only";
import type { UpstreamApiVariant, VariantContext } from "../api-variants";
import { persistImageArtifacts } from "./artifacts";
import { completeLog } from "./log";
import { HttpError } from "../response";
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
        // CRITICAL: distinguish abort/truncation from a legitimate empty
        // body. The earlier `await upstream.json().catch(() => ({}))`
        // swallowed AbortError + invalid JSON + truncation alike, then
        // logged the call as `status: "completed"` with null output and
        // returned 200 — making a mid-body timeout indistinguishable from
        // a clean empty response. Read text first; on parse failure,
        // mark the log failed and surface a 502 so the caller knows.
        let bodyText: string;
        try {
            bodyText = await upstream.text();
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            completeLog(logId, {
                status: "failed",
                reason: `Upstream body read failed: ${reason}`,
                totalLatencyMs: Date.now() - started,
            });
            throw new HttpError(`Upstream body read failed: ${reason}`, 502);
        }
        let json: unknown;
        if (!bodyText) {
            // Empty body is legal (some upstreams return 200 + "" on
            // success no-op). Continue with empty object so the
            // downstream parser/log writers don't NPE.
            json = {};
        } else {
            try {
                json = JSON.parse(bodyText);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                completeLog(logId, {
                    status: "failed",
                    reason: `Upstream returned invalid JSON: ${reason}`,
                    output: bodyText.slice(0, 4096),
                    totalLatencyMs: Date.now() - started,
                });
                throw new HttpError(`Upstream returned invalid JSON: ${reason}`, 502);
            }
        }
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

        // Honor variant-reported terminal failure (R14): parseResponse
        // sets `error` when the upstream returned HTTP 200 with
        // `status:"failed"` / "incomplete" — promote to failed log +
        // FE error so the chat row shows retry instead of a green
        // bubble. Same UX contract as the streaming path.
        completeLog(logId, {
            status: parsed.error ? "failed" : "completed",
            output: parsed.output,
            reason: parsed.error ?? null,
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
            error: parsed.error,
        });
        return {
            response: new Response(JSON.stringify(parsed.normalized), {
                headers: { "Content-Type": "application/json" },
            }),
            logId,
        };
    }

    // Binary or unknown — log size, pass through. arrayBuffer() can
    // throw on abort/timeout/truncation mid-body; without this guard
    // the `generation_logs` row would sit at `status: "pending"`
    // forever (the route's defineRoute wrapper converts the throw to
    // 500 but never touches the log row).
    let buf: ArrayBuffer;
    try {
        buf = await upstream.arrayBuffer();
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        completeLog(logId, {
            status: "failed",
            reason: `Upstream binary body read failed: ${reason}`,
            totalLatencyMs: Date.now() - started,
        });
        throw new HttpError(`Upstream binary body read failed: ${reason}`, 502);
    }
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
