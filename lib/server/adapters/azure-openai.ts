import "server-only";
import { registerAdapter, type ProviderAdapter, type UpstreamCallArgs } from ".";
import {
    applyFieldFilter,
    bearerAuthHeaders,
    defaultSelectUpstreamApi,
} from "./openai";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { Provider } from "../db/schema";

/**
 * Azure OpenAI — the "first-party" Azure-hosted OpenAI models (gpt-4o,
 * gpt-3.5-turbo, …). Wraps each call into a per-deployment URL and uses
 * the `api-key` header instead of Bearer.
 *
 * URL shape:
 *   POST {base_url}/openai/deployments/{deployment}/{capability.path}?api-version=…
 *
 * Discovery: `/openai/models?api-version=…` returns the catalog of BASE
 * model names (not callable deployment ids). The user has to register a
 * Model row in the admin UI mapping a display name to the actual
 * deployment id; that's why we surface base models with `chat: false`
 * here — they're informational only and not directly callable.
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
    // The Foundry adapter checks for inference.ai.azure.com which is
    // technically a *.ai.azure.com host (not .openai.azure.com), so this
    // check is safe to overlap.
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
        const res = await fetch(url, { headers });
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
            // Azure OpenAI catalog returns BASE model names. They're not
            // directly callable — the user needs to register a deployment
            // row in the admin UI. Mark `chat: false` so UI knows.
            supported_apis: [],
            capabilities: { chat: false },
            owned_by: typeof r.owned_by === "string" ? r.owned_by : null,
            raw: rawEntry,
        };
    },

    selectUpstreamApi(capability, _model, meta) {
        return defaultSelectUpstreamApi(capability.id, meta);
    },

    upstreamUrl(args: UpstreamCallArgs) {
        const deployment = encodeURIComponent(args.model.upstreamModelId);
        const path = args.capability.endpoint.path;
        const v = apiVersion(args.provider);
        return `${baseUrl(args.provider)}/openai/deployments/${deployment}${path}?api-version=${encodeURIComponent(v)}`;
    },

    upstreamHeaders(_args, apiKey) {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) h["api-key"] = apiKey;
        return h;
    },

    transformRequest(body, args) {
        // Azure routes to the deployment via URL — `model` in body is
        // redundant and historically rejected.
        const { model: _drop, ...rest } = body;
        void _drop;
        return applyFieldFilter(rest, args.meta);
    },
};

registerAdapter(azureOpenAIAdapter);

// Re-export to also keep them on bearerAuthHeaders import paths (no-op)
export { bearerAuthHeaders };
