import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { authenticateBearer, getCurrentUser, type SessionUser } from "./auth";
import { decryptSecret } from "./crypto";
import { findModelByIdOrName } from "./serializers";
import { badRequest, HttpError, notFound, unauthorized } from "./response";
import type { Model, Provider } from "./db/schema";

export interface ResolvedModel {
    model: Model;
    provider: Provider;
    apiKey: string | null;
}

export function resolveModel(name: string): ResolvedModel {
    const model = findModelByIdOrName(name);
    if (!model) throw notFound(`Model "${name}" not found`);
    if (!model.enabled) throw badRequest(`Model "${name}" is disabled`);
    const provider = db.select().from(schema.providers).where(eq(schema.providers.id, model.providerId)).get();
    if (!provider) throw notFound(`Provider for model "${name}" not found`);
    if (!provider.enabled) throw badRequest(`Provider "${provider.name}" is disabled`);
    const apiKey = decryptSecret(provider.apiKeyEncrypted);
    return { model, provider, apiKey };
}

/** Authenticate via session cookie OR Bearer api key. Returns the resolved user. */
export async function authenticateGateway(req: Request): Promise<SessionUser> {
    const header = req.headers.get("Authorization");
    if (header && /^Bearer\s+/i.test(header)) {
        return authenticateBearer(req);
    }
    const cookieUser = await getCurrentUser();
    if (cookieUser) return cookieUser;
    throw unauthorized("Missing or invalid credentials");
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

function upstreamUrl(provider: Provider, model: Model, path: "/chat/completions" | "/embeddings"): string {
    const base = provider.baseUrl.replace(/\/$/, "");
    if (provider.type === "azure") {
        // Azure routes calls per deployment: /openai/deployments/<deployment><path>?api-version=...
        // The "deployment" is the per-model upstreamModelId. Default to a recent stable api-version
        // if the provider didn't pin one (we'd rather forward a working request than 400).
        const deployment = encodeURIComponent(model.upstreamModelId);
        const apiVersion = provider.apiVersion?.trim() || "2024-10-21";
        return `${base}/openai/deployments/${deployment}${path}?api-version=${encodeURIComponent(apiVersion)}`;
    }
    return `${base}${path}`;
}

function buildUpstreamHeaders(provider: Provider, apiKey: string | null): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
        if (provider.type === "azure") {
            // Azure uses a custom header instead of Authorization: Bearer
            h["api-key"] = apiKey;
        } else {
            h["Authorization"] = `Bearer ${apiKey}`;
        }
    }
    return h;
}

export interface GatewayLogPayload {
    userId: string;
    modelName: string;
    requestBody: Record<string, unknown>;
    conversationId?: string;
    messageId?: string;
}

function startLog(payload: GatewayLogPayload): string {
    const id = randomUUID();
    db.insert(schema.generationLogs).values({
        id,
        userId: payload.userId,
        modelName: payload.modelName,
        status: "pending",
        input: payload.requestBody,
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
        output?: string;
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
        output: fields.output,
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

export interface ChatCompletionsForwardResult {
    response: Response;
    logId: string;
}

/**
 * Forward an OpenAI-style chat completion request. Handles both streaming and
 * non-streaming. Always writes a GenerationLog row. Streaming responses tee
 * the body so we can record final content while forwarding bytes to the caller.
 */
export async function forwardChatCompletions(
    user: SessionUser,
    body: Record<string, unknown>,
    opts?: {
        conversationId?: string;
        messageId?: string;
        onStreamDelta?: (delta: { content: string; reasoning: string }) => void;
        onComplete?: (info: { content: string; reasoning: string; usage?: Record<string, unknown> }) => void;
    },
): Promise<ChatCompletionsForwardResult> {
    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!requestedModel) throw badRequest("`model` is required");

    const { model, provider, apiKey } = resolveModel(requestedModel);
    const merged = mergeParams(body, model, provider);
    // Azure infers the model from the deployment in the URL path; sending `model` is
    // harmless but redundant. OpenAI-compatible providers need it set to the upstream id.
    if (provider.type === "azure") {
        delete merged.model;
    } else {
        merged.model = model.upstreamModelId;
    }
    const stream = !!merged.stream;

    const logId = startLog({
        userId: user.id,
        modelName: model.name,
        requestBody: merged,
        conversationId: opts?.conversationId,
        messageId: opts?.messageId,
    });

    const started = Date.now();
    let upstream: Response;
    try {
        upstream = await fetch(upstreamUrl(provider, model, "/chat/completions"), {
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
        const json = await upstream.json().catch(() => ({}));
        const message = json?.choices?.[0]?.message ?? {};
        const content: string = typeof message.content === "string" ? message.content : "";
        const reasoning: string = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
        const usage = json?.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

        completeLog(logId, {
            status: "completed",
            output: content,
            content: json,
            generation: json,
            promptTokens: usage?.prompt_tokens ?? null,
            completionTokens: usage?.completion_tokens ?? null,
            totalTokens: usage?.total_tokens ?? null,
            latencyMs: Date.now() - started,
        });

        opts?.onComplete?.({ content, reasoning, usage });

        return {
            response: new Response(JSON.stringify(json), {
                headers: { "Content-Type": "application/json" },
            }),
            logId,
        };
    }

    // Streaming: tee the body so we can accumulate content while forwarding.
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
                    const delta = json?.choices?.[0]?.delta ?? {};
                    const c = typeof delta.content === "string" ? delta.content : "";
                    const r = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
                    if (c) accumContent += c;
                    if (r) accumReasoning += r;
                    if (c || r) opts?.onStreamDelta?.({ content: c, reasoning: r });
                    if (json?.usage) usage = json.usage;
                } catch {
                    // ignore parse errors mid-stream
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
            opts?.onComplete?.({ content: accumContent, reasoning: accumReasoning, usage });
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

export async function forwardEmbeddings(
    user: SessionUser,
    body: Record<string, unknown>,
): Promise<Response> {
    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!requestedModel) throw badRequest("`model` is required");

    const { model, provider, apiKey } = resolveModel(requestedModel);
    const merged = mergeParams(body, model, provider);
    if (provider.type === "azure") {
        delete merged.model;
    } else {
        merged.model = model.upstreamModelId;
    }

    const logId = startLog({ userId: user.id, modelName: model.name, requestBody: merged });
    const started = Date.now();

    let upstream: Response;
    try {
        upstream = await fetch(upstreamUrl(provider, model, "/embeddings"), {
            method: "POST",
            headers: buildUpstreamHeaders(provider, apiKey),
            body: JSON.stringify(merged),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        completeLog(logId, { status: "failed", reason: message, latencyMs: Date.now() - started });
        throw new HttpError(`Upstream request failed: ${message}`, 502);
    }

    const json = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
        completeLog(logId, {
            status: "failed",
            reason: `Upstream HTTP ${upstream.status}`,
            output: JSON.stringify(json).slice(0, 4000),
            latencyMs: Date.now() - started,
        });
        return new Response(JSON.stringify(json), { status: upstream.status, headers: { "Content-Type": "application/json" } });
    }

    const usage = json?.usage as { prompt_tokens?: number; total_tokens?: number } | undefined;
    completeLog(logId, {
        status: "completed",
        content: json,
        generation: json,
        promptTokens: usage?.prompt_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        latencyMs: Date.now() - started,
    });
    return new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } });
}
