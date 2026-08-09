import "server-only";
import { registerAdapter, type ProviderAdapter, type ResourceCallArgs, type UpstreamCallArgs } from ".";
import { classifyModel } from "../capabilities";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { Provider } from "../db/schema";

/**
 * Shared transport helpers for OpenAI-shaped upstreams. Lives here so
 * the other adapters (azure-openai, azure-foundry) can reuse the URL /
 * header / model-listing pieces without duplication.
 *
 * Policy: the gateway never implicitly injects request fields. Stream
 * usage etc. flow through provider/model `default_params` + caller body.
 * The adapter only owns transport (URL, auth, last-mile body shaping
 * such as model-id stamping).
 */

// ----- URL / header helpers -----

/** Standard `{base_url}{variant.path}` URL builder. */
export function defaultUpstreamUrl(args: UpstreamCallArgs): string {
    const base = args.provider.baseUrl.replace(/\/$/, "");
    return `${base}${args.variant.path}`;
}

/** Standard `Authorization: Bearer …` header. */
export function bearerAuthHeaders(_args: UpstreamCallArgs, apiKey: string | null): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
}

/** Default `${baseUrl}${path}?${query}` builder for follow-up
 *  resource paths (poll status, download, delete). Azure adapters
 *  override to wrap with deployment + api-version. */
export function defaultResourceUrl(args: ResourceCallArgs): string {
    const base = args.provider.baseUrl.replace(/\/$/, "");
    let url = `${base}${args.path}`;
    if (args.query) url += `?${args.query}`;
    return url;
}

/** Default `Authorization: Bearer …` for follow-up resource requests.
 *  Azure adapters override to `api-key: …`. */
export function bearerResourceHeaders(
    _args: ResourceCallArgs,
    apiKey: string | null,
): Record<string, string> {
    const h: Record<string, string> = {};
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
}

/** Default timeout for discovery `/models` requests. Long-tail to
 *  cover slow providers (Azure deployments, on-prem), but bounded so
 *  a wedged TCP doesn't permanently hang the discovery refresh —
 *  which would block every call to a non-DB model AND every
 *  unfiltered `GET /api/models` (both walk providers in parallel). */
const DISCOVERY_TIMEOUT_MS = 15_000;

/** Standard OpenAI `/v1/models` list endpoint. */
export async function fetchOpenAIModels(provider: Provider, apiKey: string | null): Promise<unknown[]> {
    const url = `${provider.baseUrl.replace(/\/$/, "")}/models`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    if (!res.ok) {
        throw new Error(`models discovery HTTP ${res.status} from ${url}`);
    }
    const json = (await res.json()) as { data?: unknown[] } | unknown[];
    if (Array.isArray(json)) return json;
    return Array.isArray(json?.data) ? json.data : [];
}

// ----- field filter -----

/** Always-on keys bypass `accepted_fields` / `rejected_fields` because they
 *  are carry-through routing / payload keys that the variant translation
 *  needs to keep producing valid output. */
const ALWAYS_ON = new Set(["model", "messages", "stream", "input", "prompt"]);

/** Filter `body` to only fields in `accepted` (or remove fields in `rejected`).
 *  Operates on the gateway's canonical body shape (chat-completion-like) so
 *  it runs BEFORE the variant translation; the variant produces a clean
 *  per-shape body from whatever fields survived the filter. */
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

// =============================================================================
// The "openai" adapter — OpenAI direct + generic OpenAI-compat (DeepSeek,
// Together, Groq, Fireworks, vLLM, Ollama, …). Catch-all fallback.
// =============================================================================

export const openaiAdapter: ProviderAdapter = {
    id: "openai",
    label: "OpenAI compatible",
    description: "OpenAI direct, DeepSeek, Together, Groq, vLLM, Ollama — any /v1 OpenAI-compatible upstream.",

    matches: () => true, // catch-all fallback; see `fallback` below
    fallback: true,

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
                : cap === "video" ? "videos"
                : "chat.completions",
            ],
            capabilities: {
                chat: cap === "chat",
                embeddings: cap === "embedding",
                audio_in: cap === "audio.transcription",
                audio_out: cap === "audio.speech",
            },
            owned_by: typeof r.owned_by === "string" ? r.owned_by : null,
            raw: rawEntry,
        };
    },

    upstreamUrl: defaultUpstreamUrl,
    upstreamHeaders: bearerAuthHeaders,
    resourceUrl: defaultResourceUrl,
    resourceHeaders: bearerResourceHeaders,

    finalizeRequest(body, args) {
        // Stamp the upstream id so callers can reference a model by its
        // display name without confusing the upstream.
        return { ...body, model: args.model.upstreamModelId };
    },
};

registerAdapter(openaiAdapter);
