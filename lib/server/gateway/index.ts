import "server-only";
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
    type UpstreamCallArgs,
} from "../adapters";
// Side-effect import: registers every built-in adapter.
import "../adapters/register";
import { applyFieldFilter } from "../adapters/openai";
import { getVariant, type VariantContext } from "../api-variants";
// Side-effect import: registers every built-in upstream API variant.
import "../api-variants/register";
import { getPreferences } from "../preferences";
import { badRequest, HttpError, notFound } from "../response";
import type { Model, Provider } from "../db/schema";

import { completeLog, startLog } from "./log";
import { handleStream } from "./stream";
import { handleNonStream } from "./non-stream";
import type {
    AssembledToolCall,
    ForwardGenerationOpts,
    ForwardResult,
    ResolvedModel,
} from "./types";

// Re-exports keep the public API stable for callers that import from
// `@/lib/server/gateway`. Splitting log/stream/non-stream/types into
// sibling files is an internal refactor only.
export { authenticateGateway };
export type { AssembledToolCall, ForwardGenerationOpts, ForwardResult, ResolvedModel };
export { forwardMultipartGeneration, gatewayProxy } from "./multipart";

// =============================================================================
// Model resolution
// =============================================================================

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
        timeout: 3600,
        maxRetries: 2,
        httpProxy: null,
        enabled: true,
        apiVariantId: null,
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
 *  always wins. The gateway never injects fields on its own.
 *
 *  Special-case ONE-LEVEL deep merge for `stream_options`,
 *  `reasoning`, and `response_format` — these are nested-object knobs
 *  whose admin defaults a caller usually wants to *augment* rather
 *  than *replace*. Without this, e.g. `provider.default_params =
 *  {stream_options: {include_usage: true}}` would silently lose
 *  include_usage the moment a caller body had any other
 *  `stream_options` key (a common shape for OpenAI Python SDK on
 *  reasoning models). Other top-level keys keep last-write-wins. */
const NESTED_MERGE_KEYS = new Set(["stream_options", "reasoning", "response_format"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function mergeParams(
    body: Record<string, unknown>,
    model: Model,
    provider: Provider,
): Record<string, unknown> {
    const providerDefaults = (provider.defaultParams ?? {}) as Record<string, unknown>;
    const modelDefaults = (model.defaultParams ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...providerDefaults, ...modelDefaults, ...body };
    // Re-merge whitelisted nested-object keys so per-key admin defaults
    // survive a caller that touches the same parent key.
    //
    // EXCEPT when the caller explicitly passes a NON-OBJECT value at
    // that key (e.g. `null` to clear a default, `false`, etc.) — the
    // doc contract says caller always wins, so a deliberate
    // suppression must not be silently overwritten by re-merging
    // admin defaults under it.
    for (const k of NESTED_MERGE_KEYS) {
        const callerVal = body[k];
        if (k in body && !isPlainObject(callerVal)) continue;
        const layers = [providerDefaults[k], modelDefaults[k], callerVal].filter(isPlainObject);
        if (layers.length > 1) merged[k] = Object.assign({}, ...layers);
    }
    return merged;
}

// =============================================================================
// Forward
// =============================================================================

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

    // Build the upstream body in stages. Wrap the request-translation
    // segment so a misshapen body / variant-translator throw surfaces
    // as 400 (client error) rather than a 500 with a raw stack — these
    // are caller-input errors, not gateway internal failures.
    let merged: Record<string, unknown>;
    let upstreamBody: Record<string, unknown>;
    try {
        merged = mergeParams(body, model, provider);
        const filtered = applyFieldFilter(merged, meta);
        const transformed = variant.transformRequest?.(filtered, ctx) ?? filtered;
        upstreamBody = adapter.finalizeRequest?.(transformed, callArgs) ?? transformed;
    } catch (err) {
        if (err instanceof HttpError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw badRequest(
            `Failed to translate request body for variant "${variant.id}": ${message}`,
        );
    }

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
    // Effective timeout = MIN(model.timeout, user_pref.gateway_timeout_seconds).
    // Both default to 3600s. The min semantics:
    //   - Admin can cap per-model (e.g. set model.timeout=120 for a
    //     fast endpoint so callers don't tie up resources).
    //   - User can cap globally (e.g. set 60s in their personal
    //     prefs to fail-fast all calls regardless of the model).
    //   - Whichever is stricter wins, so neither setting can be
    //     silently bypassed by the other. Earlier code did
    //     `userTimeoutSec || model.timeout` which always picked the
    //     user pref (since the schema enforces `.min(1)` so it's
    //     never falsy) and the per-model column was unreachable —
    //     editing model timeout did nothing.
    // Streaming responses don't tick down the timeout per-chunk —
    // it's a TTFB-ish bound that errors out if the upstream hangs
    // before sending headers.
    const userTimeoutSec = getPreferences(user.id).gateway_timeout_seconds;
    const effectiveSec = Math.max(1, Math.min(userTimeoutSec, model.timeout));
    const timeoutMs = effectiveSec * 1000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;

    let upstream: Response;
    // Per-model retry budget — `model.max_retries` (default 2) is the
    // number of EXTRA attempts after the initial one for retriable
    // failures (network reject, upstream 5xx, upstream 429). 4xx ≠ 429
    // are NOT retried (they're caller errors). Retries are NOT applied
    // to caller-disconnect aborts (signal already fired). Backoff
    // doubles each retry up to a 5s cap so a flaky upstream doesn't
    // hold the connection forever.
    const maxRetries = Math.max(0, model.maxRetries);
    let attempt = 0;
    let lastErrMessage: string | null = null;
    while (true) {
        try {
            upstream = await fetch(adapter.upstreamUrl(callArgs), {
                method: "POST",
                headers: adapter.upstreamHeaders(callArgs, apiKey),
                body: JSON.stringify(upstreamBody),
                signal: combinedSignal,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Don't retry caller aborts / timeouts — the signal already
            // tells us the deadline is gone.
            const isAbort = combinedSignal.aborted ||
                (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
            if (isAbort || attempt >= maxRetries) {
                completeLog(logId, { status: "failed", reason: message, totalLatencyMs: Date.now() - started });
                throw new HttpError(`Upstream request failed: ${message}`, 502);
            }
            lastErrMessage = message;
            attempt += 1;
            await new Promise((r) => setTimeout(r, Math.min(5_000, 250 * 2 ** (attempt - 1))));
            continue;
        }
        // Retriable HTTP: 5xx or 429.
        if ((upstream.status >= 500 || upstream.status === 429) && attempt < maxRetries) {
            // Drain to free the connection before retrying.
            try { await upstream.body?.cancel(); } catch { /* swallow */ }
            lastErrMessage = `Upstream HTTP ${upstream.status}`;
            attempt += 1;
            await new Promise((r) => setTimeout(r, Math.min(5_000, 250 * 2 ** (attempt - 1))));
            continue;
        }
        break;
    }
    void lastErrMessage;

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
        return handleNonStream({ upstream, variant, ctx, opts, started, logId });
    }
    return handleStream({ upstream, variant, ctx, opts, started, logId, model });
}
