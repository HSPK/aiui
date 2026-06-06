/**
 * Display-friendly labels for capability ids. Capability ids are dot-style
 * (`audio.speech`, `audio.transcription`) for namespacing on the server,
 * but rendering them verbatim in the UI looks like a path. Single source
 * of truth so list/table/badge/card all agree.
 *
 * New capabilities fall back to a Title-Cased version of the id.
 */
const KNOWN: Record<string, string> = {
    chat: "Chat",
    embedding: "Embedding",
    image: "Image",
    "audio.speech": "Speech",
    "audio.transcription": "Transcription",
    rerank: "Rerank",
};

export function capabilityLabel(id: string | null | undefined): string {
    if (!id) return "—";
    if (KNOWN[id]) return KNOWN[id];
    // Fallback: take the last segment, title-case.
    const tail = id.includes(".") ? id.split(".").pop()! : id;
    return tail.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
