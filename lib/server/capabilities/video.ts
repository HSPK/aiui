import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "video",
    label: "Video generation",
    description: "Text-to-video (asynchronous; create + poll + download).",
    defaultVariantId: "videos",
    priority: 30,
    matches: (id) => /\b(sora|veo|kling|runway|gen-?\d|luma|pika|wan|hailuo|cogvideo|mochi|hunyuan-video)/i.test(id),
    summarizeInput: (body) => {
        const prompt = (body as { prompt?: unknown }).prompt;
        const seconds = (body as { seconds?: number | string }).seconds;
        const size = (body as { size?: string }).size;
        const text = typeof prompt === "string" ? prompt.slice(0, 160) : "";
        const tags: string[] = [];
        if (seconds) tags.push(`${seconds}s`);
        if (size) tags.push(size);
        return tags.length > 0 ? `[${tags.join(" ")}] ${text}` : text;
    },
});
