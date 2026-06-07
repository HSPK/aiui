import "server-only";
import type { UpstreamApiId } from "@/lib/schemas/adapter";

/**
 * Capability registry — describes one *user-facing modality* (chat,
 * embedding, image, audio.*, rerank). Capability is independent of the
 * wire shape (which is owned by `lib/server/api-variants/`) and of the
 * upstream provider (owned by `lib/server/adapters/`).
 *
 * A capability declares its default wire variant; the actual selection
 * per request goes through `adapter.selectVariant(capability, model, meta)`
 * which consults the model's `meta.supported_apis` and falls back here.
 *
 * Adding a new modality is a self-contained operation: drop a file in
 * `lib/server/capabilities/`, register it with `registerCapability(...)`,
 * register the wire shape via `registerVariant(...)`, and add a thin
 * Route Handler that calls `forwardGeneration(user, "<id>", body)`.
 * The gateway core needs no changes.
 */

export interface CapabilityHandler {
    /** Stable id used by Models.type and the routing tables (e.g. "chat", "image"). */
    id: string;
    /** Human-readable label shown in admin UI selectors. */
    label: string;
    /** Optional one-line description for tooltips / docs. */
    description?: string;
    /** Default upstream API variant when the model declares no specific
     *  preference via `meta.supported_apis` and the preference chain
     *  yields no match. */
    defaultVariantId: UpstreamApiId;
    /** Ordered preference list of variants for this modality. The
     *  selector walks this list (most-preferred first) and picks the
     *  first one the model declares support for. Decouples gateway-side
     *  opinion (e.g. "Responses API is more capable than Chat Completions
     *  for chat") from per-adapter metadata ordering. Omit to fall back
     *  to whatever variant the model declared first. */
    variantPreference?: UpstreamApiId[];
    /** Cheap heuristic to recognise this capability from a `/models` listing id. */
    matches?: (modelId: string) => boolean;
    /** Higher priority handlers run first when classifying a discovered model. Default 0. */
    priority?: number;
    /** Build a short input summary (≤120 chars) suitable for the logs
     *  table. Operates on the gateway's canonical chat-completion shape
     *  body BEFORE any variant-specific translation. */
    summarizeInput?: (body: Record<string, unknown>) => string;
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
