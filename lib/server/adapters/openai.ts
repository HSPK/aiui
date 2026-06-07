import "server-only";
import { registerAdapter, type ProviderAdapter, type UpstreamCallArgs } from ".";
import { classifyModel } from "../capabilities";
import type { NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";
import type { Provider } from "../db/schema";

/**
 * Shared helpers for adapters that speak OpenAI's Chat Completions /
 * Embeddings / etc. surface. Keeps the per-adapter files focused on
 * what's actually different (URL shape, header style, schema strictness).
 *
 * Policy: the gateway never implicitly injects request fields. If a caller
 * wants `stream_options.include_usage` (or any other extra), they set it
 * either in the request body, the model's `default_params`, or the
 * provider's `default_params` (which the model inherits). `mergeParams`
 * walks those three layers; this module only owns transport-level shape
 * (URL, auth, field accept/reject).
 */

/** Build the standard URL: `{base_url}{capability.endpoint.path}`. */
export function defaultUpstreamUrl(args: UpstreamCallArgs): string {
    const base = args.provider.baseUrl.replace(/\/$/, "");
    const path = args.capability.endpoint.path;
    return `${base}${path}`;
}

/** Standard OpenAI `Authorization: Bearer …` header. */
export function bearerAuthHeaders(_args: UpstreamCallArgs, apiKey: string | null): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
}

/** Standard OpenAI `/v1/models` list endpoint. */
export async function fetchOpenAIModels(provider: Provider, apiKey: string | null): Promise<unknown[]> {
    const url = `${provider.baseUrl.replace(/\/$/, "")}/models`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`models discovery HTTP ${res.status} from ${url}`);
    }
    const json = (await res.json()) as { data?: unknown[] } | unknown[];
    if (Array.isArray(json)) return json;
    return Array.isArray(json?.data) ? json.data : [];
}

/** Filter `body` to only fields in `accepted` (or remove fields in `rejected`).
 *  Always-on keys (`model`, `messages`, `stream`, `input`, `prompt`) bypass
 *  both lists since they're carry-through routing/payload keys. */
const ALWAYS_ON = new Set(["model", "messages", "stream", "input", "prompt"]);

export function applyFieldFilter(
    body: Record<string, unknown>,
    meta: NormalizedModelMeta | null,
): Record<string, unknown> {
    if (!meta) return body;
    const accepted = meta.accepted_fields && meta.accepted_fields.length > 0
        ? new Set(meta.accepted_fields)
        : null;
    const rejected = meta.rejected_fields && meta.rejected_fields.length > 0
        ? new Set(meta.rejected_fields)
        : null;
    if (!accepted && !rejected) return body;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
        if (ALWAYS_ON.has(k)) {
            out[k] = v;
            continue;
        }
        if (rejected?.has(k)) continue;
        if (accepted && !accepted.has(k)) continue;
        out[k] = v;
    }
    return out;
}

/**
 * Default upstream API picker — favours `responses` when the model
 * declares support for it (gateway-side opinion that the Responses API
 * is more capable), otherwise falls back to `chat.completions`. Other
 * capabilities pass through unchanged.
 */
export function defaultSelectUpstreamApi(
    capabilityId: string,
    meta: NormalizedModelMeta | null,
): UpstreamApiId {
    switch (capabilityId) {
        case "chat":
            if (meta?.supported_apis.includes("responses")) return "responses";
            return "chat.completions";
        case "embedding":
            return "embeddings";
        case "image":
            return "images.generations";
        case "audio.speech":
            return "audio.speech";
        case "audio.transcription":
            return "audio.transcriptions";
        case "rerank":
            return "rerank";
        default:
            return "chat.completions";
    }
}

// =============================================================================
// The "openai" adapter — OpenAI direct + generic OpenAI-compat (DeepSeek,
// Together, Groq, Fireworks, vLLM, Ollama, …). Catch-all fallback.
// =============================================================================

export const openaiAdapter: ProviderAdapter = {
    id: "openai",
    label: "OpenAI compatible",
    description: "OpenAI direct, DeepSeek, Together, Groq, vLLM, Ollama — any /v1 OpenAI-compatible upstream.",

    matches: () => true, // catch-all fallback; specific adapters register earlier

    fetchModels: fetchOpenAIModels,

    extractModelMeta(rawEntry): NormalizedModelMeta | null {
        const r = rawEntry as Record<string, unknown>;
        const id = typeof r?.id === "string" ? r.id : null;
        if (!id) return null;

        // Bare /v1/models doesn't say what the model can do — fall back to
        // id-based classification so embeddings/audio/image models don't
        // all collapse to "chat".
        const cap = classifyModel(id);
        return {
            upstream_id: id,
            label: id,
            supported_apis: [
                cap === "embedding" ? "embeddings"
                : cap === "image" ? "images.generations"
                : cap === "audio.speech" ? "audio.speech"
                : cap === "audio.transcription" ? "audio.transcriptions"
                : cap === "rerank" ? "rerank"
                : "chat.completions",
            ],
            capabilities: {
                chat: cap === "chat",
                embeddings: cap === "embedding",
                audio_in: cap === "audio.transcription",
                audio_out: cap === "audio.speech",
            },
            owned_by: typeof r.owned_by === "string" ? r.owned_by : null,
            // accepted_fields left undefined ⇒ trust everything
            raw: rawEntry,
        };
    },

    selectUpstreamApi(capability, _model, meta) {
        return defaultSelectUpstreamApi(capability.id, meta);
    },

    upstreamUrl: defaultUpstreamUrl,
    upstreamHeaders: bearerAuthHeaders,

    transformRequest(body, args) {
        // Sticky model id in case caller used a display name
        const withModel = { ...body, model: args.model.upstreamModelId };
        return applyFieldFilter(withModel, args.meta);
    },
};

registerAdapter(openaiAdapter);
