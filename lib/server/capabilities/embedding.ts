import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "embedding",
    label: "Embedding",
    description: "Vector embeddings. OpenAI /embeddings shape.",
    endpoint: { path: "/embeddings" },
    supportsStreaming: false,
    priority: 20,
    matches: (id) => /\b(embedding|embed|bge|gte|m3e|e5|cohere-embed|text-embedding)/i.test(id),
    summarizeInput: (body) => {
        const input = (body as { input?: unknown }).input;
        if (typeof input === "string") return input.slice(0, 200);
        if (Array.isArray(input)) {
            return `${input.length} input(s): ${input.map((s) => (typeof s === "string" ? s : "")).join(" / ").slice(0, 200)}`;
        }
        return "";
    },
    parseResponse: (json) => {
        const j = json as { usage?: { prompt_tokens?: number; total_tokens?: number }; data?: Array<{ embedding?: number[] }> };
        const dim = j?.data?.[0]?.embedding?.length;
        return {
            output: dim ? `${j.data!.length} vector(s) × ${dim} dim` : null,
            promptTokens: j?.usage?.prompt_tokens ?? null,
            totalTokens: j?.usage?.total_tokens ?? null,
        };
    },
});
