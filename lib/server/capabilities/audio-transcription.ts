import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "audio.transcription",
    label: "Speech-to-text",
    description: "Transcribe audio to text. OpenAI /audio/transcriptions shape.",
    endpoint: { path: "/audio/transcriptions" },
    supportsStreaming: false,
    priority: 25,
    matches: (id) => /\b(whisper|stt|transcribe|asr|conformer|paraformer)/i.test(id),
    summarizeInput: () => "audio input",
    parseResponse: (json) => {
        const text = (json as { text?: string })?.text;
        return { output: typeof text === "string" ? text.slice(0, 400) : null };
    },
});
