import "server-only";
import { registerAdapter, type ProviderAdapter, type UpstreamCallArgs } from ".";
import {
    applyFieldFilter,
    defaultSelectUpstreamApi,
    fetchOpenAIModels,
    maybeInjectStreamUsage,
} from "./openai";
import type { NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";

/**
 * Azure AI Inference / Foundry — the "serverless inference" endpoints
 * that serve OSS / partner / custom models (Mistral, Llama, Phi, xAI
 * Grok, Cohere, etc.) behind an OpenAI-style URL surface.
 *
 * Defining quirks:
 *   - URL form: {base_url}/v1/chat/completions (no deployment wrapping)
 *   - Auth: `api-key` header (same as Azure OpenAI)
 *   - **Strict schema** — `extra-parameters: error` is the default, so
 *     any request field outside the underlying model's own schema returns
 *     HTTP 400. The OpenAI gateway-injected `stream_options` triggers
 *     this regularly.
 *   - **Rich /models metadata** with non-standard nested shape:
 *       {
 *         id: "...",
 *         model: { Publisher, Format, Name, Version, ... },
 *         capabilities: { chatCompletion: "true", batch: "true", ... },
 *         RateLimits: { requests, tokens },
 *         owned_by: "...",
 *       }
 */

/** Map a Foundry capabilities-block key to our supported_apis enum. */
const CAP_KEY_TO_API: Record<string, UpstreamApiId> = {
    chatCompletion: "chat.completions",
    responses: "responses",
    embeddings: "embeddings",
    imageGeneration: "images.generations",
    audioSpeech: "audio.speech",
    audioTranscription: "audio.transcriptions",
    rerank: "rerank",
};

/** A best-effort baseline of fields a generic OpenAI-spec OSS model
 *  hosted on Foundry is likely to accept. Tuned to exclude the OpenAI-
 *  proprietary additions that trigger `extra-parameters: error` 400s. */
const FOUNDRY_OSS_ACCEPTED_FIELDS = [
    "model",
    "messages",
    "stream",
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "stop",
    "n",
    "frequency_penalty",
    "presence_penalty",
    "logit_bias",
    "user",
    "seed",
    "tools",
    "tool_choice",
    "response_format",
];

/** Foundry-specific fields the upstream is known to NOT accept on most
 *  OSS models — these MUST NOT be injected by the gateway. */
const FOUNDRY_OSS_REJECTED_FIELDS = [
    "stream_options",
    "parallel_tool_calls",
    "service_tier",
    "store",
    "metadata",
    "prediction",
    "modalities",
    "audio",
    "web_search_options",
];

function isFoundryHost(host: string): boolean {
    // Common Foundry inference hosts:
    //   <name>.inference.ai.azure.com         (regional)
    //   <name>.services.ai.azure.com          (serverless)
    //   <name>.cognitiveservices.azure.com    (some legacy)
    //   <name>.openai.azure.com               (also used when deployed via Foundry-OpenAI mode)
    return /\.(inference|services)\.ai\.azure\.com$/.test(host);
}

export const azureFoundryAdapter: ProviderAdapter = {
    id: "azure-foundry",
    label: "Azure AI Foundry (Inference)",
    description: "Azure AI Inference / Foundry endpoints serving OSS or partner models. Strict schema, rich metadata.",

    matches(provider) {
        try {
            const u = new URL(provider.baseUrl);
            return isFoundryHost(u.host);
        } catch {
            return false;
        }
    },

    fetchModels: fetchOpenAIModels,

    extractModelMeta(rawEntry): NormalizedModelMeta | null {
        const r = rawEntry as Record<string, unknown>;
        const id = typeof r?.id === "string" ? r.id : null;
        if (!id) return null;

        // ----- supported_apis from `capabilities` block -----
        const supportedApis: UpstreamApiId[] = [];
        const caps = (r.capabilities ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(caps)) {
            const truthy = value === true || value === "true" || value === 1;
            if (!truthy) continue;
            const api = CAP_KEY_TO_API[key];
            if (api && !supportedApis.includes(api)) supportedApis.push(api);
        }
        // Default to chat.completions if Foundry didn't advertise anything
        // explicitly (some Foundry deployments omit the block).
        if (supportedApis.length === 0) supportedApis.push("chat.completions");

        // ----- nested `model.*` (xAI / Mistral / Meta / …) -----
        const m = (r.model ?? {}) as Record<string, unknown>;
        const publisher = (m.Publisher as string | null | undefined) ?? null;
        const format = (m.Format as string | null | undefined) ?? null;
        const version = (m.Version as string | null | undefined) ?? null;

        // ----- RateLimits block (capital R is Foundry convention) -----
        const rl = (r.RateLimits ?? r.rate_limits ?? {}) as Record<string, unknown>;

        return {
            upstream_id: id,
            label: typeof m.Name === "string" ? m.Name : id,
            supported_apis: supportedApis,
            capabilities: {
                chat: supportedApis.includes("chat.completions"),
                responses: supportedApis.includes("responses"),
                embeddings: supportedApis.includes("embeddings"),
                batch: caps.batch === true || caps.batch === "true",
            },
            // The crucial bit: strict whitelist + explicit reject of the
            // OpenAI-proprietary fields that this endpoint family rejects
            // with `extra-parameters: error` 400s.
            accepted_fields: FOUNDRY_OSS_ACCEPTED_FIELDS,
            rejected_fields: FOUNDRY_OSS_REJECTED_FIELDS,
            publisher,
            version,
            format,
            owned_by: typeof r.owned_by === "string" ? r.owned_by : null,
            rate_limits: {
                requests: typeof rl.requests === "number" ? rl.requests : null,
                tokens: typeof rl.tokens === "number" ? rl.tokens : null,
            },
            raw: rawEntry,
        };
    },

    selectUpstreamApi(capability, _model, meta) {
        return defaultSelectUpstreamApi(capability.id, meta);
    },

    upstreamUrl(args: UpstreamCallArgs) {
        const base = args.provider.baseUrl.replace(/\/$/, "");
        return `${base}${args.capability.endpoint.path}`;
    },

    upstreamHeaders(_args, apiKey) {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) h["api-key"] = apiKey;
        return h;
    },

    transformRequest(body, args) {
        const withModel = { ...body, model: args.model.upstreamModelId };
        const filtered = applyFieldFilter(withModel, args.meta);
        // maybeInjectStreamUsage already checks accepted/rejected_fields,
        // so it'll skip injection for Foundry OSS models.
        return maybeInjectStreamUsage(filtered, args);
    },
};

registerAdapter(azureFoundryAdapter);
