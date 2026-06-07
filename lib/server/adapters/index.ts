import "server-only";
import type { Model, Provider } from "../db/schema";
import type { CapabilityHandler } from "../capabilities";
import type {
    AdapterDescriptor,
    AdapterId,
    NormalizedModelMeta,
    UpstreamApiId,
} from "@/lib/schemas/adapter";
import type { UpstreamApiVariant } from "../api-variants";
import { defaultSelectVariantId } from "../api-variants";

/**
 * ProviderAdapter — the *transport* layer. One adapter per upstream
 * provider flavour (OpenAI direct, Azure OpenAI, Azure Foundry, future
 * Anthropic / Vertex / Bedrock native, etc.).
 *
 * What the adapter owns:
 *   • discovery (fetchModels + extractModelMeta)
 *   • URL composition (uses variant.path under the hood)
 *   • auth headers
 *   • per-provider final body shaping (e.g. Azure drops `model`)
 *   • selecting which API variant to use for a given (capability, model)
 *
 * What the adapter does NOT own:
 *   • request body translation (chat → responses, etc.)        → variant
 *   • response/stream parsing                                   → variant
 *
 * Adding a new transport flavour = one file in this folder + one line
 * in register.ts. The gateway core never branches on `adapter.id`.
 */

export interface ProviderAdapter {
    readonly id: AdapterId;
    readonly label: string;
    readonly description?: string;

    /**
     * Auto-detect: return true if this adapter is the right choice for the
     * given provider when no explicit `provider.adapter_id` is set. The
     * registry walks adapters in registration order and returns the first
     * hit, so more specific adapters (azure-foundry) must register BEFORE
     * more general ones (openai).
     */
    matches(provider: Provider): boolean;

    // ----- discovery -----

    fetchModels(provider: Provider, apiKey: string | null): Promise<unknown[]>;
    extractModelMeta(rawEntry: unknown, provider: Provider): NormalizedModelMeta | null;

    // ----- routing -----

    /**
     * Pick which upstream API variant id to use for a given (capability,
     * model). Default implementation defers to `defaultSelectVariantId`
     * which walks `meta.supported_apis` and falls back to the
     * capability's `defaultVariantId`.
     */
    selectVariant?(
        capability: CapabilityHandler,
        model: Model,
        meta: NormalizedModelMeta | null,
    ): UpstreamApiId;

    /** Build the full URL given the chosen variant. */
    upstreamUrl(args: UpstreamCallArgs): string;

    /** HTTP headers (auth + content-type + extras). */
    upstreamHeaders(args: UpstreamCallArgs, apiKey: string | null): Record<string, string>;

    /**
     * Optional last-mile body shaping that runs AFTER the variant
     * translation and AFTER field filtering. Default: stamp the
     * upstream model id on the body. Azure-OpenAI overrides to drop
     * `model` (deployment routes via URL instead).
     */
    finalizeRequest?(body: Record<string, unknown>, args: UpstreamCallArgs): Record<string, unknown>;
}

/** Context passed to every per-request adapter method. */
export interface UpstreamCallArgs {
    provider: Provider;
    model: Model;
    meta: NormalizedModelMeta | null;
    capability: CapabilityHandler;
    variant: UpstreamApiVariant;
    /** True iff `body.stream === true` and `variant.supportsStreaming`. */
    stream: boolean;
}

// =============================================================================
// Registry
// =============================================================================

const registry: ProviderAdapter[] = [];
const byId = new Map<AdapterId, ProviderAdapter>();

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

/** Convenience: resolve the variant id an adapter would use for this
 *  (capability, model). Falls back to the shared default selector when
 *  the adapter doesn't customize selection. */
export function resolveVariantId(
    adapter: ProviderAdapter,
    capability: CapabilityHandler,
    model: Model,
    meta: NormalizedModelMeta | null,
): UpstreamApiId {
    if (adapter.selectVariant) return adapter.selectVariant(capability, model, meta);
    return defaultSelectVariantId(capability, meta);
}
