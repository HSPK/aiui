import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "chat",
    label: "Chat",
    description: "Conversational completion. OpenAI /chat/completions shape.",
    endpoint: { path: "/chat/completions" },
    supportsStreaming: true,
    priority: 10,
    matches: (id) =>
        /^(gpt|chatgpt|o\d|claude|gemini|llama|qwen|deepseek-(chat|r1|reasoner|v\d)|mistral|mixtral|grok|yi|baichuan|moonshot|kimi|hunyuan|glm|spark|abab|step|doubao|ernie)/i.test(id) ||
        /-(chat|instruct)\b/i.test(id),
    summarizeInput: (body) => {
        const messages = (body as { messages?: Array<{ role?: string; content?: unknown }> }).messages;
        if (!Array.isArray(messages) || messages.length === 0) return "";
        const lastUser = [...messages].reverse().find((m) => m?.role === "user");
        const target = lastUser ?? messages[messages.length - 1];
        const content = target?.content;
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
            text = content
                .map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? ""))
                .filter(Boolean)
                .join(" ");
        }
        return text.slice(0, 200);
    },
    parseResponse: (json) => {
        const j = json as {
            choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const message = j?.choices?.[0]?.message;
        return {
            output: message?.content ?? null,
            promptTokens: j?.usage?.prompt_tokens ?? null,
            completionTokens: j?.usage?.completion_tokens ?? null,
            totalTokens: j?.usage?.total_tokens ?? null,
        };
    },
    parseStreamChunk: (json) => {
        const delta = (json as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> })
            ?.choices?.[0]?.delta;
        return {
            content: typeof delta?.content === "string" ? delta.content : "",
            reasoning: typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "",
        };
    },
});
