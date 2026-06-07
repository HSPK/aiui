import { ApiError, fetcher, rawFetch } from "./client";
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
};
