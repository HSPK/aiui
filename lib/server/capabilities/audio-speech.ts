import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "audio.speech",
    label: "Text-to-speech",
    description: "Synthesize speech audio from text.",
    defaultVariantId: "audio.speech",
    priority: 25,
    matches: (id) => /\b(tts|speech|voice|elevenlabs|piper|xtts|fish)/i.test(id),
    summarizeInput: (body) => {
        const input = (body as { input?: unknown }).input;
        const voice = (body as { voice?: string }).voice;
        const text = typeof input === "string" ? input.slice(0, 180) : "";
        return voice ? `[${voice}] ${text}` : text;
    },
});
