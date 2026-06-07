import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "chat",
    label: "Chat",
    description: "Conversational completion. Canonical OpenAI chat-completion shape.",
    defaultVariantId: "chat.completions",
    // Gateway opinion: Responses API is more capable (better tool calls,
    // reasoning, multi-step) so prefer it when the model claims support.
    variantPreference: ["responses", "chat.completions"],
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
});
