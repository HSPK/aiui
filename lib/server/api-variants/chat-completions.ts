import "server-only";
import { registerVariant, type UpstreamApiVariant } from ".";

/**
 * /v1/chat/completions — the canonical chat shape. The gateway uses
 * chat-completion as its lingua-franca, so this variant is a near-pass-through.
 */
export const chatCompletionsVariant: UpstreamApiVariant = {
    id: "chat.completions",
    capability: "chat",
    path: "/chat/completions",
    supportsStreaming: true,

    parseResponse(json) {
        const j = json as {
            id?: string;
            model?: string;
            choices?: Array<{
                message?: { content?: string; reasoning_content?: string };
                finish_reason?: string;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const message = j?.choices?.[0]?.message;
        const usage = j?.usage ?? {};
        return {
            output: message?.content ?? null,
            promptTokens: usage.prompt_tokens ?? null,
            completionTokens: usage.completion_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            // Pass-through — already in canonical shape.
            normalized: j as unknown as Record<string, unknown>,
        };
    },

    parseStreamChunk(json) {
        const j = json as {
            id?: string;
            model?: string;
            system_fingerprint?: string;
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
            usage?: Record<string, unknown>;
        };
        const delta = j?.choices?.[0]?.delta;
        return {
            content: typeof delta?.content === "string" ? delta.content : "",
            reasoning: typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "",
            id: typeof j?.id === "string" ? j.id : undefined,
            model: typeof j?.model === "string" ? j.model : undefined,
            systemFingerprint:
                typeof j?.system_fingerprint === "string" ? j.system_fingerprint : undefined,
            usage: j?.usage,
        };
    },
};

registerVariant(chatCompletionsVariant);
