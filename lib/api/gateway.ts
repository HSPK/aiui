import { API_BASE, ApiError, fetcher, rawFetch } from "./client";
import type {
    PlaygroundEmbeddingInput,
    PlaygroundEmbeddingResult,
} from "@/lib/schemas/playground";

interface PlaygroundChatBody {
    message: string;
    model: string;
    conversation_id?: string;
    parent_message_id?: string | null;
    user_message_id?: string;
    system?: string;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    reasoning_effort?: "low" | "medium" | "high";
    history_limit?: number;
    stream?: boolean;
}

interface TitleArgs {
    model: string;
    user: string;
    assistant: string;
}

// ---- modality bodies for the OpenAI-compatible passthrough endpoints ----

export interface ImageGenerationBody {
    model: string;
    prompt: string;
    n?: number;
    size?: string;
    quality?: string;
    style?: string;
    response_format?: "url" | "b64_json";
    /** gpt-image-1 only — output container format. */
    output_format?: "png" | "jpeg" | "webp";
    /** gpt-image-1 only — `auto` | `transparent` | `opaque`. */
    background?: "auto" | "transparent" | "opaque";
    user?: string;
}

export interface ImageGenerationResponse {
    created?: number;
    data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface SpeechBody {
    model: string;
    input: string;
    voice: string;
    response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
    speed?: number;
    instructions?: string;
}

export interface TranscriptionResponse {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{ id: number; start: number; end: number; text: string }>;
}

export interface VideoCreateFields {
    model: string;
    prompt: string;
    seconds?: number | string;
    size?: string;
    /** Optional reference image (image-to-video). */
    input_reference?: File;
}

export interface VideoJob {
    id: string;
    object: "video";
    status: "queued" | "in_progress" | "completed" | "failed";
    model: string;
    seconds: string | number;
    size: string;
    progress: number;
    prompt?: string | null;
    created_at: number;
    completed_at?: number | null;
    expires_at?: number | null;
    error?: { code?: string; message?: string } | null;
}

/**
 * Direct streaming / non-streaming gateway calls used by the playground UI.
 * Returns the raw Response — the chat stream-client reads SSE chunks from
 * `res.body` and pulls `X-Conversation-ID` / `X-Message-ID` /
 * `X-Generation-ID` headers off the response.
 */
export const gateway = {
    playgroundChat: (body: PlaygroundChatBody) =>
        rawFetch("/playground/chat", { method: "POST", body: JSON.stringify(body) }),

    /** Run the same A/B pair through every requested model and return
     *  vectors + cosine similarity. Goes through the standard envelope
     *  like other internal endpoints, so error handling is uniform. */
    playgroundEmbedding: (body: PlaygroundEmbeddingInput) =>
        fetcher<PlaygroundEmbeddingResult>("/playground/embedding", {
            method: "POST",
            body: JSON.stringify(body),
        }),

    /** Title generator (uses the in-house OpenAI-compatible endpoint over cookie). */
    async generateTitle({ model, user, assistant }: TitleArgs): Promise<string> {
        const res = await rawFetch("/v1/chat/completions", {
            method: "POST",
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: "Generate a concise title (3-6 words) for this conversation. Output only the title, no quotes or extra text." },
                    { role: "user", content: `User: ${user.slice(0, 500)}\n\nAssistant: ${assistant.slice(0, 500)}` },
                ],
                max_tokens: 30,
                temperature: 0.7,
                stream: false,
            }),
        }).catch((err) => {
            if (err instanceof ApiError) throw err;
            throw new ApiError("Failed to generate title", 500);
        });
        const json = await res.json();
        const title = json.choices?.[0]?.message?.content?.trim() || "New Chat";
        return title.replace(/^["']|["']$/g, "").slice(0, 50);
    },

    // ----- images -----

    async imageGenerate(body: ImageGenerationBody): Promise<ImageGenerationResponse> {
        const res = await rawFetch("/v1/images/generations", {
            method: "POST",
            body: JSON.stringify(body),
        });
        return (await res.json()) as ImageGenerationResponse;
    },

    // ----- audio: text-to-speech -----

    /** Returns a Blob of the synthesised audio (mime depends on response_format). */
    async speech(body: SpeechBody): Promise<Blob> {
        const res = await rawFetch("/v1/audio/speech", {
            method: "POST",
            body: JSON.stringify(body),
        });
        return await res.blob();
    },

    // ----- audio: transcription -----

    async transcribe(args: {
        model: string;
        file: File;
        language?: string;
        prompt?: string;
        response_format?: "json" | "text" | "srt" | "verbose_json" | "vtt";
        temperature?: number;
    }): Promise<TranscriptionResponse | string> {
        const fd = new FormData();
        fd.append("model", args.model);
        fd.append("file", args.file);
        if (args.language) fd.append("language", args.language);
        if (args.prompt) fd.append("prompt", args.prompt);
        if (args.response_format) fd.append("response_format", args.response_format);
        if (args.temperature != null) fd.append("temperature", String(args.temperature));
        const res = await rawFetch("/v1/audio/transcriptions", {
            method: "POST",
            body: fd,
        });
        const ct = res.headers.get("Content-Type") ?? "";
        if (ct.includes("application/json")) {
            return (await res.json()) as TranscriptionResponse;
        }
        return await res.text();
    },

    // ----- video: Sora-compatible create + poll + download -----

    async videoCreate(fields: VideoCreateFields): Promise<VideoJob> {
        const fd = new FormData();
        fd.append("model", fields.model);
        fd.append("prompt", fields.prompt);
        if (fields.seconds != null) fd.append("seconds", String(fields.seconds));
        if (fields.size) fd.append("size", fields.size);
        if (fields.input_reference) fd.append("input_reference", fields.input_reference);
        const res = await rawFetch("/v1/videos", { method: "POST", body: fd });
        return (await res.json()) as VideoJob;
    },

    async videoGet(id: string, model: string): Promise<VideoJob> {
        const res = await rawFetch(
            `/v1/videos/${encodeURIComponent(id)}?model=${encodeURIComponent(model)}`,
        );
        return (await res.json()) as VideoJob;
    },

    async videoDelete(id: string, model: string): Promise<void> {
        await rawFetch(
            `/v1/videos/${encodeURIComponent(id)}?model=${encodeURIComponent(model)}`,
            { method: "DELETE" },
        );
    },

    /** Returns the public proxy URL for the binary content. Stable for use
     *  in `<video src=…>` / `<a download>`; the browser handles caching
     *  and partial range requests against the same-origin proxy. */
    videoContentUrl(
        id: string,
        model: string,
        variant: "video" | "thumbnail" | "spritesheet" = "video",
    ): string {
        const qs = new URLSearchParams({ model, variant }).toString();
        // Must go through API_BASE like every other call: a deployment that
        // sets NEXT_PUBLIC_API_URL (different origin or base path) would
        // otherwise get video/thumbnail URLs pointing at the current origin's
        // /api, and playback would 404.
        return `${API_BASE}/v1/videos/${encodeURIComponent(id)}/content?${qs}`;
    },
};
