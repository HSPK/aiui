import "server-only";

/**
 * Capability registry.
 *
 * A "capability" describes one upstream interaction shape — chat completion,
 * embedding, image generation, audio synthesis, etc. Each registered
 * capability tells the generic gateway how to:
 *   • build the upstream URL (`endpoint.path`)
 *   • decide if streaming applies
 *   • recognise its own models from a `/models` listing (`matches`)
 *   • summarise a request into a one-line log entry (`summarizeInput`)
 *   • extract content + token counts from the upstream response (`parseResponse`)
 *   • extract incremental deltas while streaming (`parseStreamChunk`)
 *
 * Adding a new modality is a self-contained operation: drop a file in
 * `lib/server/capabilities/`, register it with `registerCapability(...)`, and
 * add a thin Route Handler that calls `forwardGeneration(user, "<id>", body)`.
 * The gateway core needs no changes.
 */

export interface CapabilityResponseLog {
    output?: string | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
}

export interface CapabilityStreamDelta {
    content: string;
    reasoning: string;
}

export interface CapabilityHandler {
    /** Stable id used by Models.type and the routing tables (e.g. "chat", "image"). */
    id: string;
    /** Human-readable label shown in admin UI selectors. */
    label: string;
    /** Optional one-line description for tooltips / docs. */
    description?: string;
    /** OpenAI-style path appended to provider.base_url (e.g. "/chat/completions"). */
    endpoint: { path: string };
    /** Does the upstream support stream:true requests? */
    supportsStreaming: boolean;
    /** Cheap heuristic to recognise this capability from a `/models` listing id. */
    matches?: (modelId: string) => boolean;
    /** Higher priority handlers run first when classifying a discovered model. Default 0. */
    priority?: number;
    /** Build a short input summary (≤120 chars) suitable for the logs table. */
    summarizeInput?: (body: Record<string, unknown>) => string;
    /** Parse a non-streaming upstream response into log-friendly fields. */
    parseResponse?: (json: unknown) => CapabilityResponseLog;
    /** Parse one SSE chunk's JSON into a delta (or empty if non-applicable). */
    parseStreamChunk?: (json: unknown) => CapabilityStreamDelta;
}

const registry = new Map<string, CapabilityHandler>();

export function registerCapability(handler: CapabilityHandler): void {
    if (!handler.id) throw new Error("capability.id is required");
    registry.set(handler.id, handler);
}

export function getCapability(id: string): CapabilityHandler | undefined {
    return registry.get(id);
}

export function listCapabilities(): CapabilityHandler[] {
    return Array.from(registry.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function classifyModel(modelId: string): string {
    for (const cap of listCapabilities()) {
        if (cap.matches?.(modelId)) return cap.id;
    }
    return DEFAULT_CAPABILITY_ID;
}

export const DEFAULT_CAPABILITY_ID = "chat";