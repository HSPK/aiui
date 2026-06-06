import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "image",
    label: "Image generation",
    description: "Text-to-image. OpenAI /images/generations shape.",
    endpoint: { path: "/images/generations" },
    supportsStreaming: false,
    priority: 30,
    matches: (id) => /\b(dall-?e|gpt-image|stable[-_]?diffusion|sd-?\d|sdxl|flux|imagen|midjourney|kandinsky|playground-v|cogview|ideogram)/i.test(id),
    summarizeInput: (body) => {
        const prompt = (body as { prompt?: unknown }).prompt;
        const n = (body as { n?: number }).n;
        const text = typeof prompt === "string" ? prompt.slice(0, 180) : "";
        return n && n > 1 ? `(×${n}) ${text}` : text;
    },
    parseResponse: (json) => {
        const j = json as { data?: Array<{ url?: string; b64_json?: string }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } };
        const count = j?.data?.length ?? 0;
        return {
            output: count > 0 ? `Generated ${count} image${count === 1 ? "" : "s"}` : null,
            // gpt-image-1 reports token usage; legacy dall-e doesn't.
            promptTokens: j?.usage?.input_tokens ?? null,
            completionTokens: j?.usage?.output_tokens ?? null,
            totalTokens: j?.usage?.total_tokens ?? null,
        };
    },
});
