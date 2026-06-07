import "server-only";
import { registerAdapter, type ProviderAdapter, type UpstreamCallArgs } from ".";
import { fetchOpenAIModels } from "./openai";
import type { NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";

/**
 * Azure AI Inference / Foundry — the "serverless inference" endpoints
 * that serve OSS / partner / custom models (Mistral, Llama, Phi, xAI
 * Grok, Cohere, etc.) behind an OpenAI-style URL surface.
 *
 * Defining quirks:
 *   - URL form: {base_url}{variant.path} (no deployment wrapping)
 *   - Auth: `api-key` header (same as Azure OpenAI)
 *   - **Strict schema** — `extra-parameters: error` is the default, so
 *     any request field outside the underlying model's schema returns
 *     HTTP 400. Enforced via `accepted_fields` / `rejected_fields` in
 *     extractModelMeta — the gateway-level field filter strips them
 *     before they reach upstream.
 *   - **Rich /models metadata** with non-standard nested shape:
 *       {
 *         id, model: { Publisher, Format, Name, Version, ... },
 *         capabilities: { chatCompletion, batch, ... },
 *         RateLimits: { requests, tokens },
 *         owned_by,
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

/** Best-effort baseline of fields a generic OpenAI-spec OSS model
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

        // supported_apis from the capabilities block.
        const supportedApis: UpstreamApiId[] = [];
        const caps = (r.capabilities ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(caps)) {
            const truthy = value === true || value === "true" || value === 1;
            if (!truthy) continue;
            const api = CAP_KEY_TO_API[key];
            if (api && !supportedApis.includes(api)) supportedApis.push(api);
        }
        if (supportedApis.length === 0) supportedApis.push("chat.completions");

        const m = (r.model ?? {}) as Record<string, unknown>;
        const publisher = (m.Publisher as string | null | undefined) ?? null;
        const format = (m.Format as string | null | undefined) ?? null;
        const version = (m.Version as string | null | undefined) ?? null;
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

    upstreamUrl(args: UpstreamCallArgs) {
        const base = args.provider.baseUrl.replace(/\/$/, "");
        return `${base}${args.variant.path}`;
    },

    upstreamHeaders(_args, apiKey) {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) h["api-key"] = apiKey;
        return h;
    },

    finalizeRequest(body, args) {
        // Stamp upstream id (Foundry routes to the model via body.model
        // when no deployment URL segment exists).
        return { ...body, model: args.model.upstreamModelId };
    },
};

registerAdapter(azureFoundryAdapter);
