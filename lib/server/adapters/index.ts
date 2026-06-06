import "server-only";
import type { Model, Provider } from "../db/schema";
import type { CapabilityHandler } from "../capabilities";
import type {
    AdapterDescriptor,
    AdapterId,
    NormalizedModelMeta,
    UpstreamApiId,
} from "@/lib/schemas/adapter";

/**
 * ProviderAdapter — the gateway's single point of variability across
 * upstream protocol flavours. Adding a new flavour (Anthropic native,
 * Vertex AI, Cohere, etc.) = one file in this folder + one line in
 * register.ts. The gateway core never branches on `provider.type` /
 * `adapter.id`.
 *
 * Two axes are handled by ONE adapter:
 *   - Transport: URL, headers, version, auth scheme (provider-shaped)
 *   - Schema:    field whitelist, upstream-API choice, request/response
 *                shape transforms (model-shaped — adapter consults
 *                `model.meta` which it itself populated at discovery time)
 */
export interface ProviderAdapter {
    /** Stable id, matches `providers.adapter_id` column. */
    readonly id: AdapterId;
    /** Human-readable label for the admin UI dropdown. */
    readonly label: string;
    /** Short description for the dropdown tooltip. */
    readonly description?: string;

    /**
     * Auto-detect: return true if this adapter is the right choice for the
     * given provider given no explicit `provider.adapter_id`. The registry
     * walks adapters in registration order and returns the first hit, so
     * more specific adapters (e.g. azure-foundry) must be registered
     * BEFORE more general ones (e.g. openai).
     */
    matches(provider: Provider): boolean;

    // ----- discovery -----

    /**
     * Fetch and return the raw `/models`-style entries for this provider.
     * Adapters get full freedom over URL, body, parsing — that's the
     * entire reason this layer exists.
     */
    fetchModels(provider: Provider, apiKey: string | null): Promise<unknown[]>;

    /**
     * Project a single raw entry from `fetchModels` into the gateway's
     * common shape. THIS is the protocol-difference convergence point.
     * Returning `null` filters the entry out (e.g. non-model rows).
     */
    extractModelMeta(rawEntry: unknown, provider: Provider): NormalizedModelMeta | null;

    // ----- routing -----

    /**
     * Pick which upstream API endpoint to send the request to for a given
     * capability + model. Default implementations always return
     * `"chat.completions"` etc.; Foundry/OpenAI-style might prefer
     * `"responses"` when the model declares support for it.
     */
    selectUpstreamApi(
        capability: CapabilityHandler,
        model: Model,
        meta: NormalizedModelMeta | null,
    ): UpstreamApiId;

    /** Build the URL to POST/GET the upstream API. */
    upstreamUrl(args: UpstreamCallArgs): string;

    /** Build HTTP headers (auth + extras). */
    upstreamHeaders(args: UpstreamCallArgs, apiKey: string | null): Record<string, string>;

    // ----- request / response transforms -----

    /**
     * Shape the merged request body before fetch. Responsibilities:
     *   1. Apply field whitelist / blacklist from `meta`
     *   2. Auto-inject gateway extras (e.g. `stream_options.include_usage`)
     *      that the upstream is known to accept
     *   3. Translate Chat-Completions → Responses (or other API) shape
     *      when `apiId !== "chat.completions"`
     */
    transformRequest(
        body: Record<string, unknown>,
        args: UpstreamCallArgs,
    ): Record<string, unknown>;

    /**
     * Optional: when `apiId !== "chat.completions"`, convert the upstream
     * non-streaming response back to OpenAI Chat-Completions shape so the
     * capability's `parseResponse` and the gateway's log writer keep
     * working. Omit when no transform is needed.
     */
    transformResponse?(json: unknown, args: UpstreamCallArgs): unknown;

    /**
     * Optional: per stream chunk, convert upstream shape to OpenAI Chat
     * Completions delta shape `{ content, reasoning }`. Falls back to the
     * capability's own parseStreamChunk when omitted.
     */
    transformStreamChunk?(
        json: unknown,
        args: UpstreamCallArgs,
    ): { content: string; reasoning: string } | null;
}

/** Context passed to every per-request adapter method. */
export interface UpstreamCallArgs {
    provider: Provider;
    model: Model;
    /** May be null if this is a transient (discovered, not-DB) model with no resolved meta. */
    meta: NormalizedModelMeta | null;
    capability: CapabilityHandler;
    apiId: UpstreamApiId;
    /** True iff `body.stream === true` and `capability.supportsStreaming`. */
    stream: boolean;
}

// =============================================================================
// Registry
// =============================================================================

const registry: ProviderAdapter[] = [];
const byId = new Map<AdapterId, ProviderAdapter>();

/** Register an adapter. Idempotent on `id` — registering the same id
 *  twice replaces, useful for hot-reload in dev. */
export function registerAdapter(adapter: ProviderAdapter): void {
    if (byId.has(adapter.id)) {
        const idx = registry.findIndex((a) => a.id === adapter.id);
        if (idx >= 0) registry[idx] = adapter;
    } else {
        registry.push(adapter);
    }
    byId.set(adapter.id, adapter);
}

export function getAdapter(id: AdapterId): ProviderAdapter | undefined {
    return byId.get(id);
}

export function listAdapters(): AdapterDescriptor[] {
    return registry.map((a) => ({ id: a.id, label: a.label, description: a.description }));
}

/**
 * Resolve the adapter for a given provider:
 *   1. Explicit `provider.adapter_id` wins (if it resolves to a registered
 *      adapter).
 *   2. Else walk adapters in registration order, first `matches()` wins.
 *   3. Fallback to `openai` (always registered first by register.ts).
 */
export function resolveAdapter(provider: Provider): ProviderAdapter {
    if (provider.adapterId) {
        const explicit = byId.get(provider.adapterId);
        if (explicit) return explicit;
    }
    for (const adapter of registry) {
        if (adapter.matches(provider)) return adapter;
    }
    const fallback = byId.get("openai");
    if (!fallback) {
        throw new Error("No 'openai' adapter registered — adapter registry not initialized");
    }
    return fallback;
}
