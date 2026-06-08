import "server-only";
import type { UpstreamApiId } from "@/lib/schemas/adapter";
import type { Model, Provider } from "../db/schema";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { CapabilityHandler } from "../capabilities";

/**
 * UpstreamApiVariant — the wire-shape layer between Capability (what
 * the user asked for) and ProviderAdapter (where the request goes).
 *
 * Why three layers (capability / variant / adapter)?
 *   Capability: chat / embedding / image / …       (user-facing modality)
 *   Variant:    chat.completions / responses / …   (HTTP shape + parsers)
 *   Adapter:    openai / azure-openai / foundry    (transport: URL, auth)
 *
 * The same capability ("chat") can be served by either `/v1/chat/completions`
 * or `/v1/responses` — those have entirely different request/response/SSE
 * shapes. The capability is too high to own that, the adapter is too low
 * (an OpenAI adapter serves BOTH endpoints depending on the model). So the
 * variant layer owns the wire shape and the parsers.
 *
 * Adding a new upstream API = one file in this folder + one line in
 * register.ts. Gateway core never branches on `variant.id`.
 */

// ---- types ----

export interface VariantContext {
    provider: Provider;
    model: Model;
    meta: NormalizedModelMeta | null;
    capability: CapabilityHandler;
    stream: boolean;
}

export interface NormalizedNonStreamResult {
    /** Plain-text completion content for the `output` log column. Null
     *  when the variant produces no textual primary content (e.g. an
     *  embeddings result). */
    output: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    /** Always-chat-completion shape so the log writer + the user-facing
     *  OpenAI-compatible response are uniform regardless of upstream
     *  variant. For embeddings/image/audio variants this is just the raw
     *  upstream JSON re-emitted. */
    normalized: Record<string, unknown>;
    /** Fully-assembled tool calls from `choices[0].message.tool_calls`,
     *  surfaced so the playground service can react without re-parsing
     *  `normalized`. Empty / undefined when the model did not call a tool. */
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    finishReason?: string;
}

export interface NormalizedStreamDelta {
    content: string;
    reasoning: string;
    id?: string;
    model?: string;
    systemFingerprint?: string;
    /** Final chunk only: total usage in chat-completion shape
     *  (`{prompt_tokens, completion_tokens, total_tokens, ...}`). */
    usage?: Record<string, unknown>;
    /** Tool-call function-call deltas. Each entry is a partial — `name`
     *  arrives once in the first delta, `argumentsDelta` is concatenated
     *  across subsequent deltas with the matching `index`. Mirrors
     *  OpenAI's `choices[].delta.tool_calls[]` streaming convention. */
    toolCalls?: Array<{
        index: number;
        id?: string;
        name?: string;
        argumentsDelta?: string;
    }>;
    /** Upstream-provided finish reason for this choice ("stop",
     *  "tool_calls", "length", …). Surfaced so the gateway knows when
     *  to switch into the tool-execution branch. */
    finishReason?: string;
}

export interface UpstreamApiVariant {
    readonly id: UpstreamApiId;
    /** The capability id this variant serves. One variant : one capability. */
    readonly capability: string;
    /** Path suffix appended to the provider's base URL (or wrapped into
     *  Azure's deployment URL). Includes leading slash. */
    readonly path: string;
    /** Whether this variant supports SSE streaming when the caller sets
     *  `stream: true`. */
    readonly supportsStreaming: boolean;

    /** Translate the gateway's canonical chat-completion-shaped body
     *  into the variant-specific upstream body. Identity by default. */
    transformRequest?(body: Record<string, unknown>, ctx: VariantContext): Record<string, unknown>;

    /** Parse a non-streaming upstream JSON response into normalized
     *  fields + chat-completion-shaped JSON for log storage. */
    parseResponse(json: unknown, ctx: VariantContext): NormalizedNonStreamResult;

    /** Parse a single streaming SSE chunk (already JSON-decoded).
     *  Return `null` for housekeeping events the gateway should
     *  forward to the client but not accumulate. */
    parseStreamChunk(json: unknown, ctx: VariantContext): NormalizedStreamDelta | null;
}

// ---- registry ----

const byId = new Map<UpstreamApiId, UpstreamApiVariant>();
const byCapability = new Map<string, UpstreamApiVariant[]>();

/** Idempotent on id — registering same id twice replaces in place. */
export function registerVariant(v: UpstreamApiVariant): void {
    const previous = byId.get(v.id);
    byId.set(v.id, v);
    const arr = byCapability.get(v.capability) ?? [];
    const idx = arr.findIndex((x) => x.id === v.id);
    if (idx >= 0) arr[idx] = v;
    else arr.push(v);
    byCapability.set(v.capability, arr);
    // When replacing across capabilities, clean the previous bucket too.
    if (previous && previous.capability !== v.capability) {
        const old = byCapability.get(previous.capability) ?? [];
        byCapability.set(
            previous.capability,
            old.filter((x) => x.id !== v.id),
        );
    }
}

export function getVariant(id: UpstreamApiId): UpstreamApiVariant | undefined {
    return byId.get(id);
}

export function variantsForCapability(capabilityId: string): UpstreamApiVariant[] {
    return byCapability.get(capabilityId) ?? [];
}

/** All registered variants — used by `/api/variants` and the admin UI. */
export function listVariants(): UpstreamApiVariant[] {
    return Array.from(byId.values());
}

/** Default selector used by ProviderAdapter.selectVariant when an adapter
 *  doesn't override.
 *
 *  Order of preference:
 *   1. capability.variantPreference walked top-down — pick the first one
 *      the model declares support for. This lets the gateway opine
 *      (e.g. prefer Responses over Chat Completions when both work).
 *   2. Any registered variant for this capability that appears in
 *      meta.supported_apis.
 *   3. capability.defaultVariantId.
 *   4. First variant registered for this capability.
 *
 *  Throws if no variant resolves. */
export function defaultSelectVariantId(
    capability: CapabilityHandler,
    meta: NormalizedModelMeta | null,
): UpstreamApiId {
    const supported = new Set(meta?.supported_apis ?? []);
    const candidates = variantsForCapability(capability.id);

    if (capability.variantPreference) {
        for (const id of capability.variantPreference) {
            if (supported.has(id) && byId.has(id)) return id;
        }
    }
    for (const v of candidates) {
        if (supported.has(v.id)) return v.id;
    }
    if (capability.defaultVariantId && byId.has(capability.defaultVariantId)) {
        return capability.defaultVariantId;
    }
    if (candidates.length > 0) return candidates[0].id;
    throw new Error(`No upstream API variant registered for capability "${capability.id}"`);
}
