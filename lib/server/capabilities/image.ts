import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "image",
    label: "Image generation",
    description: "Text-to-image.",
    defaultVariantId: "images.generations",
    priority: 30,
    matches: (id) => /\b(dall-?e|gpt-image|stable[-_]?diffusion|sd-?\d|sdxl|flux|imagen|midjourney|kandinsky|playground-v|cogview|ideogram)/i.test(id),
    summarizeInput: (body) => {
        const prompt = (body as { prompt?: unknown }).prompt;
        const n = (body as { n?: number }).n;
        const text = typeof prompt === "string" ? prompt.slice(0, 180) : "";
        return n && n > 1 ? `(×${n}) ${text}` : text;
    },
});
