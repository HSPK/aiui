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
                message?: {
                    content?: string;
                    reasoning_content?: string;
                    tool_calls?: Array<{
                        id?: string;
                        type?: string;
                        function?: { name?: string; arguments?: string };
                    }>;
                };
                finish_reason?: string;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const message = j?.choices?.[0]?.message;
        const finishReason = j?.choices?.[0]?.finish_reason;
        const usage = j?.usage ?? {};
        const tcRaw = Array.isArray(message?.tool_calls) ? message?.tool_calls : [];
        const toolCalls = tcRaw
            .map((tc) => ({
                id: typeof tc?.id === "string" ? tc.id : "",
                name: typeof tc?.function?.name === "string" ? tc.function.name : "",
                arguments: typeof tc?.function?.arguments === "string" ? tc.function.arguments : "",
            }))
            .filter((tc) => tc.name);
        return {
            output: message?.content ?? null,
            promptTokens: usage.prompt_tokens ?? null,
            completionTokens: usage.completion_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            // Pass-through — already in canonical shape.
            normalized: j as unknown as Record<string, unknown>,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            finishReason: typeof finishReason === "string" ? finishReason : undefined,
        };
    },

    parseStreamChunk(json) {
        const j = json as {
            id?: string;
            model?: string;
            system_fingerprint?: string;
            choices?: Array<{
                delta?: {
                    content?: string;
                    reasoning_content?: string;
                    tool_calls?: Array<{
                        index?: number;
                        id?: string;
                        type?: string;
                        function?: { name?: string; arguments?: string };
                    }>;
                };
                finish_reason?: string;
            }>;
            usage?: Record<string, unknown>;
        };
        const choice = j?.choices?.[0];
        const delta = choice?.delta;
        const toolDeltas = delta?.tool_calls;
        const toolCalls = Array.isArray(toolDeltas) && toolDeltas.length > 0
            ? toolDeltas.map((tc) => ({
                index: typeof tc.index === "number" ? tc.index : 0,
                id: typeof tc.id === "string" ? tc.id : undefined,
                name: typeof tc.function?.name === "string" ? tc.function.name : undefined,
                argumentsDelta:
                    typeof tc.function?.arguments === "string" ? tc.function.arguments : undefined,
            }))
            : undefined;
        return {
            content: typeof delta?.content === "string" ? delta.content : "",
            reasoning: typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "",
            toolCalls,
            finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
            id: typeof j?.id === "string" ? j.id : undefined,
            model: typeof j?.model === "string" ? j.model : undefined,
            systemFingerprint:
                typeof j?.system_fingerprint === "string" ? j.system_fingerprint : undefined,
            usage: j?.usage,
        };
    },
};

registerVariant(chatCompletionsVariant);

