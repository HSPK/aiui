import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { authenticateGateway, type SessionUser } from "../auth";
import { decryptSecret } from "../crypto";
import { findModelByIdOrName } from "../models";
import { getDiscoveryStatus, resolveByDiscovery } from "../discovery";
import { classifyModel, getCapability } from "../capabilities";
// Side-effect import: registers every built-in capability.
import "../capabilities/register";
import {
    resolveAdapter,
    resolveVariantId,
    type ProviderAdapter,
    type UpstreamCallArgs,
} from "../adapters";
// Side-effect import: registers every built-in adapter.
import "../adapters/register";
import { applyFieldFilter } from "../adapters/openai";
import { getVariant, type UpstreamApiVariant, type VariantContext } from "../api-variants";
// Side-effect import: registers every built-in upstream API variant.
import "../api-variants/register";
import { badRequest, HttpError, notFound } from "../response";
import type { Model, Provider } from "../db/schema";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";

export { authenticateGateway };

// =============================================================================
// Model resolution
// =============================================================================

export interface ResolvedModel {
    model: Model;
    provider: Provider;
    adapter: ProviderAdapter;
    meta: NormalizedModelMeta | null;
    apiKey: string | null;
    /** True when the Model row was synthesized on-the-fly from discovery, not pulled from DB. */
    discovered: boolean;
}

function transientModel(name: string, provider: Provider, upstreamModelId: string, capability: string): Model {
    const now = new Date().toISOString();
    return {
        id: `discovered:${provider.id}:${upstreamModelId}`,
        name,
        providerId: provider.id,
        upstreamModelId,
        type: capability,
        defaultParams: {},
        contextWindow: null,
        maxTokens: null,
        outputDimension: null,
        pricing: null,
        description: null,
        knowledgeDate: null,
        timeout: 60,
        maxRetries: 2,
        httpProxy: null,
        enabled: true,
        discoveredMetadata: null,
        createdAt: now,
        updatedAt: now,
    } as Model;
}

export async function resolveModel(name: string): Promise<ResolvedModel> {
    const model = findModelByIdOrName(name);
    if (model) {
        if (!model.enabled) throw badRequest(`Model "${name}" is disabled`);
        const provider = db.select().from(schema.providers).where(eq(schema.providers.id, model.providerId)).get();
        if (!provider) throw notFound(`Provider for model "${name}" not found`);
        if (!provider.enabled) throw badRequest(`Provider "${provider.name}" is disabled`);
        const adapter = resolveAdapter(provider);
        // Re-project DB snapshot (or warm cache) into adapter-shaped meta.
        let rawMeta: unknown = model.discoveredMetadata;
        if (rawMeta === null || rawMeta === undefined) {
            const cached = getDiscoveryStatus(provider.id);
            const hit = cached?.models.find((m) => m.id === model.upstreamModelId);
            rawMeta = hit?.meta.raw ?? { id: model.upstreamModelId };
        }
        const meta = adapter.extractModelMeta(rawMeta, provider);
        return {
            model,
            provider,
            adapter,
            meta,
            apiKey: decryptSecret(provider.apiKeyEncrypted),
            discovered: false,
        };
    }

    const discovered = await resolveByDiscovery(name);
    if (!discovered) throw notFound(`Model "${name}" not found in any provider`);

    const { provider, upstreamModelId, meta } = discovered;
    const adapter = resolveAdapter(provider);
    const capability = classifyModel(upstreamModelId);
    return {
        model: transientModel(name, provider, upstreamModelId, capability),
        provider,
        adapter,
        meta,
        apiKey: decryptSecret(provider.apiKeyEncrypted),
        discovered: true,
    };
}

/** Merge defaults under the caller's body.
 *
 *  Precedence (low → high): provider.default_params → model.default_params
 *  → caller body. Model defaults inherit from provider; caller body
 *  always wins. The gateway never injects fields on its own. */
export function mergeParams(
    body: Record<string, unknown>,
    model: Model,
    provider: Provider,
): Record<string, unknown> {
    const providerDefaults = (provider.defaultParams ?? {}) as Record<string, unknown>;
    const modelDefaults = (model.defaultParams ?? {}) as Record<string, unknown>;
    return { ...providerDefaults, ...modelDefaults, ...body };
}

// =============================================================================
// Logging
// =============================================================================

export interface GatewayLogPayload {
    userId: string;
    modelName: string;
    capability: string;
    requestBody: Record<string, unknown>;
    inputSummary: string | null;
    conversationId?: string;
    messageId?: string;
}

function startLog(payload: GatewayLogPayload): string {
    const id = randomUUID();
    db.insert(schema.generationLogs).values({
        id,
        userId: payload.userId,
        modelName: payload.modelName,
        capability: payload.capability,
        status: "pending",
        input: payload.requestBody,
        inputSummary: payload.inputSummary,
        generationKwargs: payload.requestBody,
        conversationId: payload.conversationId ?? null,
        messageId: payload.messageId ?? null,
    }).run();
    return id;
}

function completeLog(
    id: string,
    fields: {
        status: "completed" | "failed";
        output?: string | null;
        reason?: string | null;
        content?: unknown;
        generation?: Record<string, unknown> | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
        firstTokenLatencyMs?: number | null;
        totalLatencyMs?: number;
    },
) {
    db.update(schema.generationLogs).set({
        status: fields.status,
        output: fields.output ?? null,
        reason: fields.reason ?? null,
        content: fields.content ?? null,
        generation: fields.generation ?? null,
        promptTokens: fields.promptTokens ?? null,
        completionTokens: fields.completionTokens ?? null,
        totalTokens: fields.totalTokens ?? null,
        firstTokenLatencyMs: fields.firstTokenLatencyMs ?? null,
        totalLatencyMs: fields.totalLatencyMs ?? null,
        updatedAt: new Date().toISOString(),
    }).where(eq(schema.generationLogs.id, id)).run();
}

// =============================================================================
// Forward
// =============================================================================

export interface ForwardResult {
    response: Response;
    logId: string;
}

export interface ForwardGenerationOpts {
    conversationId?: string;
    messageId?: string;
    /** Called once with extracted info after a non-stream or end-of-stream completion. */
    onComplete?: (info: { content: string; reasoning: string; usage?: Record<string, unknown> }) => void;
    /** Called per stream chunk for callers that want incremental access. */
    onStreamDelta?: (delta: { content: string; reasoning: string }) => void;
}

/**
 * Generic capability-aware upstream forwarder.
 *
 * Pipeline (gateway owns; never branches on provider/variant id):
 *
 *   1. mergeParams           — caller body wins over model/provider defaults
 *   2. applyFieldFilter      — adapter-meta accept/reject (canonical shape)
 *   3. variant.transformRequest — canonical → variant-specific body
 *   4. adapter.finalizeRequest  — last-mile transport polish
 *   5. POST adapter.upstreamUrl, adapter.upstreamHeaders
 *   6a. non-stream: variant.parseResponse → normalized chat-completion JSON
 *   6b. stream:    variant.parseStreamChunk per SSE event; transcode to
 *                  chat-completion-shaped SSE so the user-facing API is
 *                  uniform regardless of upstream variant
 *
 * Adding a new upstream API shape = one file in api-variants/.
 * Adding a new upstream provider flavour = one file in adapters/.
 * Adding a new user-facing modality = one file in capabilities/ + one
 * matching variant + a 6-line Route Handler.
 */
export async function forwardGeneration(
    user: SessionUser,
    capabilityId: string,
    body: Record<string, unknown>,
    opts: ForwardGenerationOpts = {},
): Promise<ForwardResult> {
    const capability = getCapability(capabilityId);
    if (!capability) throw badRequest(`Unknown capability "${capabilityId}"`);

    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!requestedModel) throw badRequest("`model` is required");

    const { model, provider, adapter, meta, apiKey } = await resolveModel(requestedModel);

    const variantId = resolveVariantId(adapter, capability, model, meta);
    const variant = getVariant(variantId);
    if (!variant) throw badRequest(`No upstream variant registered for "${variantId}"`);
    if (variant.capability !== capability.id) {
        throw badRequest(
            `Variant "${variantId}" serves "${variant.capability}", not "${capability.id}"`,
        );
    }

    const stream = !!variant.supportsStreaming && !!body.stream;
    const ctx: VariantContext = { provider, model, meta, capability, stream };
    const callArgs: UpstreamCallArgs = { provider, model, meta, capability, variant, stream };

    // Build the upstream body in stages.
    const merged = mergeParams(body, model, provider);
    const filtered = applyFieldFilter(merged, meta);
    const transformed = variant.transformRequest?.(filtered, ctx) ?? filtered;
    const upstreamBody = adapter.finalizeRequest?.(transformed, callArgs) ?? transformed;

    // Summarize the canonical (pre-translation) body so logs reflect intent.
    const inputSummary = capability.summarizeInput?.(merged) ?? null;
    const logId = startLog({
        userId: user.id,
        modelName: model.name,
        capability: capability.id,
        requestBody: upstreamBody,
        inputSummary: inputSummary?.slice(0, 1000) ?? null,
        conversationId: opts.conversationId,
        messageId: opts.messageId,
    });

    const started = Date.now();
    let upstream: Response;
    try {
        upstream = await fetch(adapter.upstreamUrl(callArgs), {
            method: "POST",
            headers: adapter.upstreamHeaders(callArgs, apiKey),
            body: JSON.stringify(upstreamBody),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        completeLog(logId, { status: "failed", reason: message, totalLatencyMs: Date.now() - started });
        throw new HttpError(`Upstream request failed: ${message}`, 502);
    }

    if (!upstream.ok) {
        const text = await upstream.text().catch(() => upstream.statusText);
        completeLog(logId, {
            status: "failed",
            reason: `Upstream HTTP ${upstream.status}`,
            output: text.slice(0, 4000),
            totalLatencyMs: Date.now() - started,
        });
        return {
            response: new Response(text, {
                status: upstream.status,
                headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
            }),
            logId,
        };
    }

    if (!stream) {
        return handleNonStream({
            upstream,
            variant,
            ctx,
            opts,
            started,
            logId,
        });
    }
    return handleStream({
        upstream,
        variant,
        ctx,
        opts,
        started,
        logId,
        model,
    });
}

// =============================================================================
// Non-stream branch
// =============================================================================

interface BranchArgs {
    upstream: Response;
    variant: UpstreamApiVariant;
    ctx: VariantContext;
    opts: ForwardGenerationOpts;
    started: number;
    logId: string;
}

async function handleNonStream({ upstream, variant, ctx, opts, started, logId }: BranchArgs): Promise<ForwardResult> {
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

// =============================================================================
// Stream branch — always transcodes to chat-completion SSE so the
// user-facing API surface is uniform regardless of upstream variant.
// =============================================================================

interface StreamBranchArgs extends BranchArgs {
    model: Model;
}

function handleStream({ upstream, variant, ctx, opts, started, logId, model }: StreamBranchArgs): ForwardResult {
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
    let buf = "";
    let firstTokenMs: number | null = null;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const createdAt = Math.floor(started / 1000);

    const emitChunk = (
        controller: TransformStreamDefaultController<Uint8Array>,
        delta: { content?: string; reasoning?: string },
        usagePayload?: Record<string, unknown>,
        finishReason: string | null = null,
    ) => {
        const messageDelta: Record<string, unknown> = {};
        if (delta.content) messageDelta.content = delta.content;
        if (delta.reasoning) messageDelta.reasoning_content = delta.reasoning;
        const chunkObj: Record<string, unknown> = {
            id: streamId ?? logId,
            object: "chat.completion.chunk",
            created: createdAt,
            model: streamModel ?? model.upstreamModelId,
            choices: [
                {
                    index: 0,
                    delta: messageDelta,
                    finish_reason: finishReason,
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

                const hasContent = !!(delta.content || delta.reasoning);
                if (hasContent) {
                    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
                    if (delta.content) accumContent += delta.content;
                    if (delta.reasoning) accumReasoning += delta.reasoning;
                    opts.onStreamDelta?.({
                        content: delta.content ?? "",
                        reasoning: delta.reasoning ?? "",
                    });
                    emitChunk(controller, {
                        content: delta.content,
                        reasoning: delta.reasoning,
                    });
                }
            }
        },
        flush(controller) {
            // Terminal stop chunk (carries final usage if known) + [DONE].
            emitChunk(controller, {}, usage, "stop");
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));

            // Persist the merged log entry in canonical chat-completion shape.
            const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
            const message: Record<string, unknown> = { role: "assistant", content: accumContent };
            if (accumReasoning) message.reasoning_content = accumReasoning;
            const mergedResponse: Record<string, unknown> = {
                id: streamId ?? logId,
                object: "chat.completion",
                created: createdAt,
                model: streamModel ?? model.upstreamModelId,
                choices: [{ index: 0, message, finish_reason: "stop" }],
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
            opts.onComplete?.({ content: accumContent, reasoning: accumReasoning, usage });
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
