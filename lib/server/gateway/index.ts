import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { authenticateGateway, type SessionUser } from "../auth";
import { decryptSecret } from "../crypto";
import { findModelByIdOrName } from "../models";
import { resolveByDiscovery } from "../discovery";
import {
    classifyModel,
    getCapability,
    type CapabilityHandler,
} from "../capabilities";
// Side-effect import: registers every built-in capability with the registry.
// Adding a new modality is a one-line change in capabilities/register.ts.
import "../capabilities/register";
import { badRequest, HttpError, notFound } from "../response";
import type { Model, Provider } from "../db/schema";

export { authenticateGateway };

export interface ResolvedModel {
    model: Model;
    provider: Provider;
    apiKey: string | null;
    /** True when the Model row was synthesized on-the-fly from discovery, not pulled from DB. */
    discovered: boolean;
}

/** Build a transient Model object for a discovered upstream model. */
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
        createdAt: now,
        updatedAt: now,
    } as Model;
}

/**
 * Resolve a requested model name to (model, provider, apiKey).
 *
 * Order:
 *   1. DB `models` row by name — explicit overrides win. Sole path for Azure
 *      deployments and aliases.
 *   2. Discovery — scan each enabled provider's `/models` listing. The first
 *      provider that exposes this id wins; a transient Model is synthesized so
 *      the rest of the gateway code stays type-stable.
 */
export async function resolveModel(name: string): Promise<ResolvedModel> {
    const model = findModelByIdOrName(name);
    if (model) {
        if (!model.enabled) throw badRequest(`Model "${name}" is disabled`);
        const provider = db.select().from(schema.providers).where(eq(schema.providers.id, model.providerId)).get();
        if (!provider) throw notFound(`Provider for model "${name}" not found`);
        if (!provider.enabled) throw badRequest(`Provider "${provider.name}" is disabled`);
        return { model, provider, apiKey: decryptSecret(provider.apiKeyEncrypted), discovered: false };
    }

    const discovered = await resolveByDiscovery(name);
    if (!discovered) throw notFound(`Model "${name}" not found in any provider`);

    const { provider, upstreamModelId } = discovered;
    const capability = classifyModel(upstreamModelId);
    return {
        model: transientModel(name, provider, upstreamModelId, capability),
        provider,
        apiKey: decryptSecret(provider.apiKeyEncrypted),
        discovered: true,
    };
}

/** Merge provider/model default params under the user-supplied body. User wins. */
export function mergeParams(
    body: Record<string, unknown>,
    model: Model,
    provider: Provider,
): Record<string, unknown> {
    const providerDefaults = (provider.defaultParams ?? {}) as Record<string, unknown>;
    const modelDefaults = (model.defaultParams ?? {}) as Record<string, unknown>;
    return { ...providerDefaults, ...modelDefaults, ...body };
}

function upstreamUrl(provider: Provider, model: Model, capability: CapabilityHandler): string {
    const base = provider.baseUrl.replace(/\/$/, "");
    const path = capability.endpoint.path;
    if (provider.type === "azure") {
        // Azure routes per deployment: /openai/deployments/<deployment><path>?api-version=...
        const deployment = encodeURIComponent(model.upstreamModelId);
        const apiVersion = provider.apiVersion?.trim() || "2024-10-21";
        return `${base}/openai/deployments/${deployment}${path}?api-version=${encodeURIComponent(apiVersion)}`;
    }
    return `${base}${path}`;
}

function buildUpstreamHeaders(provider: Provider, apiKey: string | null): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
        if (provider.type === "azure") h["api-key"] = apiKey;
        else h["Authorization"] = `Bearer ${apiKey}`;
    }
    return h;
}

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
        latencyMs?: number;
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
        latencyMs: fields.latencyMs ?? null,
        updatedAt: new Date().toISOString(),
    }).where(eq(schema.generationLogs.id, id)).run();
}

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
 * Generic capability-aware upstream forwarder. Use this for any new modality:
 *   1. Register a CapabilityHandler in lib/server/capabilities/
 *   2. Wire a thin Route Handler that does: forwardGeneration(user, "<id>", body)
 *
 * Streaming requests are tee'd through a TransformStream so the bytes reach
 * the client unmodified while we accumulate content for the log row.
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

    const { model, provider, apiKey } = await resolveModel(requestedModel);

    const merged = mergeParams(body, model, provider);
    if (provider.type === "azure") {
        // Azure infers the model from the URL deployment; sending it is redundant.
        delete merged.model;
    } else {
        merged.model = model.upstreamModelId;
    }
    const stream = !!capability.supportsStreaming && !!merged.stream;

    const inputSummary = capability.summarizeInput?.(merged) ?? null;
    const logId = startLog({
        userId: user.id,
        modelName: model.name,
        capability: capability.id,
        requestBody: merged,
        inputSummary: inputSummary?.slice(0, 1000) ?? null,
        conversationId: opts.conversationId,
        messageId: opts.messageId,
    });

    const started = Date.now();
    let upstream: Response;
    try {
        upstream = await fetch(upstreamUrl(provider, model, capability), {
            method: "POST",
            headers: buildUpstreamHeaders(provider, apiKey),
            body: JSON.stringify(merged),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        completeLog(logId, { status: "failed", reason: message, latencyMs: Date.now() - started });
        throw new HttpError(`Upstream request failed: ${message}`, 502);
    }

    if (!upstream.ok) {
        const text = await upstream.text().catch(() => upstream.statusText);
        completeLog(logId, {
            status: "failed",
            reason: `Upstream HTTP ${upstream.status}`,
            output: text.slice(0, 4000),
            latencyMs: Date.now() - started,
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
        // For known capabilities, parse JSON. For unknown / binary-content types
        // (audio.speech for example returns audio/mpeg), pass through raw.
        const contentType = upstream.headers.get("Content-Type") ?? "";
        if (contentType.startsWith("application/json")) {
            const json = await upstream.json().catch(() => ({}));
            const parsed = capability.parseResponse?.(json) ?? {};
            completeLog(logId, {
                status: "completed",
                output: parsed.output ?? null,
                content: json,
                generation: typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null,
                promptTokens: parsed.promptTokens ?? null,
                completionTokens: parsed.completionTokens ?? null,
                totalTokens: parsed.totalTokens ?? null,
                latencyMs: Date.now() - started,
            });
            opts.onComplete?.({
                content: typeof parsed.output === "string" ? parsed.output : "",
                reasoning: "",
                usage: (json as { usage?: Record<string, unknown> })?.usage,
            });
            return {
                response: new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } }),
                logId,
            };
        }
        // Binary or unknown response — log generically and pass through.
        const buf = await upstream.arrayBuffer();
        completeLog(logId, {
            status: "completed",
            output: `binary response (${contentType || "unknown"}, ${buf.byteLength} bytes)`,
            latencyMs: Date.now() - started,
        });
        return {
            response: new Response(buf, { headers: { "Content-Type": contentType || "application/octet-stream" } }),
            logId,
        };
    }

    // ---- streaming branch ----
    if (!upstream.body) {
        completeLog(logId, { status: "failed", reason: "Upstream returned empty stream", latencyMs: Date.now() - started });
        throw new HttpError("Upstream returned empty stream", 502);
    }

    let accumContent = "";
    let accumReasoning = "";
    let usage: Record<string, unknown> | undefined;
    let buf = "";

    const decoder = new TextDecoder();
    const transformer = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            controller.enqueue(chunk);
            const text = decoder.decode(chunk, { stream: true });
            buf += text;
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                try {
                    const json = JSON.parse(data);
                    const delta = capability.parseStreamChunk?.(json) ?? { content: "", reasoning: "" };
                    if (delta.content) accumContent += delta.content;
                    if (delta.reasoning) accumReasoning += delta.reasoning;
                    if (delta.content || delta.reasoning) opts.onStreamDelta?.(delta);
                    const maybeUsage = (json as { usage?: Record<string, unknown> })?.usage;
                    if (maybeUsage) usage = maybeUsage;
                } catch {
                    // ignore mid-stream parse errors
                }
            }
        },
        flush() {
            const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
            completeLog(logId, {
                status: "completed",
                output: accumContent,
                content: { content: accumContent, reasoning_content: accumReasoning },
                generation: usage ?? null,
                promptTokens: u?.prompt_tokens ?? null,
                completionTokens: u?.completion_tokens ?? null,
                totalTokens: u?.total_tokens ?? null,
                latencyMs: Date.now() - started,
            });
            opts.onComplete?.({ content: accumContent, reasoning: accumReasoning, usage });
        },
    });

    const piped = upstream.body.pipeThrough(transformer);
    const response = new Response(piped, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
    return { response, logId };
}
