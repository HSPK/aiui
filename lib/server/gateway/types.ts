import "server-only";
import type { Model, Provider } from "../db/schema";
import type { ProviderAdapter } from "../adapters";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";

/** Tool calls in the form the playground service dispatches them by:
 *  the model has fully committed to a name + JSON args string. */
export interface AssembledToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface ResolvedModel {
    model: Model;
    provider: Provider;
    adapter: ProviderAdapter;
    meta: NormalizedModelMeta | null;
    apiKey: string | null;
    /** True when the Model row was synthesized on-the-fly from discovery, not pulled from DB. */
    discovered: boolean;
}

export interface ForwardResult {
    response: Response;
    logId: string;
}

export interface ForwardGenerationOpts {
    conversationId?: string;
    messageId?: string;
    /** Called once with extracted info after a non-stream or end-of-stream completion. */
    onComplete?: (info: {
        content: string;
        reasoning: string;
        usage?: Record<string, unknown>;
        toolCalls?: AssembledToolCall[];
        finishReason?: string;
    }) => void;
    /** Called per stream chunk for callers that want incremental access. */
    onStreamDelta?: (delta: { content: string; reasoning: string }) => void;
}
