import "server-only";
import { registerAdapter, type ProviderAdapter, type ResourceCallArgs, type UpstreamCallArgs } from ".";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { Provider } from "../db/schema";

/**
 * Azure OpenAI — first-party Azure-hosted OpenAI models. Wraps each call
 * into a per-deployment URL and uses the `api-key` header.
 *
 *   POST {base_url}/openai/deployments/{deployment}{variant.path}?api-version=…
 *
 * The variant's path (e.g. `/chat/completions`, `/responses`) slots in
 * after the deployment segment.
 *
 * Discovery: `/openai/models?api-version=…` returns BASE model names
 * (not callable deployment ids). The user must register a Model row
 * mapping a display name to the deployment id; surfaced here with
 * `capabilities.chat = false` to flag that.
 */

const DEFAULT_API_VERSION = "2024-10-21";

function apiVersion(provider: Provider): string {
    return provider.apiVersion?.trim() || DEFAULT_API_VERSION;
}

function baseUrl(provider: Provider): string {
    return provider.baseUrl.replace(/\/$/, "");
}

function isAzureOpenAIHost(host: string): boolean {
    // First-party Azure OpenAI hosts always end with .openai.azure.com.
    return /\.openai\.azure\.com$/.test(host);
}

export const azureOpenAIAdapter: ProviderAdapter = {
    id: "azure-openai",
    label: "Azure OpenAI",
    description: "First-party Azure-hosted OpenAI models. Deployment-based URLs, api-key header, api-version query.",

    matches(provider) {
        try {
            const u = new URL(provider.baseUrl);
            return isAzureOpenAIHost(u.host);
        } catch {
            return false;
        }
    },

    async fetchModels(provider, apiKey) {
        const url = `${baseUrl(provider)}/openai/models?api-version=${encodeURIComponent(apiVersion(provider))}`;
        const headers: Record<string, string> = { Accept: "application/json" };
        if (apiKey) headers["api-key"] = apiKey;
        // 15s timeout matches lib/server/adapters/openai.ts:DISCOVERY_TIMEOUT_MS —
        // bound the discovery fetch so a wedged Azure endpoint can't
        // permanently hang `listAllDiscovered` / `resolveByDiscovery`.
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
            throw new Error(`models discovery HTTP ${res.status} from ${url}`);
        }
        const json = (await res.json()) as { data?: unknown[] } | unknown[];
        return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    },

    extractModelMeta(rawEntry): NormalizedModelMeta | null {
        const r = rawEntry as Record<string, unknown>;
        const id = typeof r?.id === "string" ? r.id : null;
        if (!id) return null;
        return {
            upstream_id: id,
            label: id,
            // Azure OpenAI catalog returns BASE model names — not directly
            // callable. The user must register a deployment row in the
            // admin UI. Mark `chat: false` so UI knows.
            supported_apis: [],
            capabilities: { chat: false },
            owned_by: typeof r.owned_by === "string" ? r.owned_by : null,
            raw: rawEntry,
        };
    },

    upstreamUrl(args: UpstreamCallArgs) {
        const deployment = encodeURIComponent(args.model.upstreamModelId);
        const v = apiVersion(args.provider);
        return `${baseUrl(args.provider)}/openai/deployments/${deployment}${args.variant.path}?api-version=${encodeURIComponent(v)}`;
    },

    upstreamHeaders(_args, apiKey) {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) h["api-key"] = apiKey;
        return h;
    },

    /** Follow-up resource paths (poll/download/delete) must hit the
     *  same deployment + api-version slot so Azure can route them. */
    resourceUrl(args: ResourceCallArgs) {
        const deployment = encodeURIComponent(args.model.upstreamModelId);
        const v = encodeURIComponent(apiVersion(args.provider));
        let url = `${baseUrl(args.provider)}/openai/deployments/${deployment}${args.path}?api-version=${v}`;
        if (args.query) url += `&${args.query}`;
        return url;
    },

    /** Azure uses `api-key` header, NOT `Authorization: Bearer`. */
    resourceHeaders(_args, apiKey) {
        const h: Record<string, string> = {};
        if (apiKey) h["api-key"] = apiKey;
        return h;
    },

    finalizeRequest(body) {
        // Azure routes to the deployment via URL — `model` in body is
        // redundant and historically rejected.
        const { model: _drop, ...rest } = body;
        void _drop;
        return rest;
    },
};

registerAdapter(azureOpenAIAdapter);
