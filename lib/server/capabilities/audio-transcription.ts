import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "audio.transcription",
    label: "Speech-to-text",
    description: "Transcribe audio to text.",
    defaultVariantId: "audio.transcriptions",
    priority: 25,
    matches: (id) => /\b(whisper|stt|transcribe|asr|conformer|paraformer)/i.test(id),
    summarizeInput: () => "audio input",
});
