import { z } from "zod";

/**
 * Canonical chat-message content shape — modelled on OpenAI's
 * multimodal chat-completion payload so it round-trips upstream without
 * translation in the chat.completions variant. Variants that need a
 * different shape (Responses API: input_text / input_image / input_file)
 * translate on the way out.
 *
 * Always-array content is allowed too — a plain text turn can be either
 * a bare string OR `[{type:"text", text:"…"}]`; both are accepted
 * end-to-end and rendered the same way.
 */

export const textPartSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});

export const imageUrlPartSchema = z.object({
    type: z.literal("image_url"),
    image_url: z.object({
        /** Either an https:// URL or a `data:` URL. Inline base64 is the
         *  default path from the FE — no server-side upload needed. */
        url: z.string(),
        detail: z.enum(["auto", "low", "high"]).optional(),
    }),
});

export const filePartSchema = z.object({
    type: z.literal("file"),
    file: z.object({
        filename: z.string(),
        /** Inline `data:<mime>;base64,…` URL. */
        file_data: z.string(),
        /** Convenience copy of the mime type, for FE chip icons. */
        mime_type: z.string().optional(),
    }),
});

/**
 * Tool-call request: an assistant message asks the runtime to invoke
 * one or more registered tools. Mirrors OpenAI's
 * `choices[].message.tool_calls[]` shape so chat.completions can
 * round-trip without translation. We model each call as a single
 * ContentPart so the FE renders them in-order with other text/image
 * parts; the upstream-facing shape is reconstructed in the variant
 * layer when forwarding back as conversation history.
 */
export const toolCallPartSchema = z.object({
    type: z.literal("tool_call"),
    tool_call: z.object({
        id: z.string(),
        name: z.string(),
        /** Stored as a string for fidelity with upstream — JSON-parsed
         *  for display only. */
        arguments: z.string(),
        /** Friendly origin label, populated server-side from the MCP
         *  server name so the UI can show "github · search_repositories"
         *  without a separate lookup. */
        source: z.string().optional(),
    }),
});

/**
 * Tool result: a `role: "tool"` message body carrying the textual
 * output of a single tool invocation, linked back via
 * `tool_call_id`. Errors are marked via `is_error: true` so the UI
 * can style them distinctly.
 */
export const toolResultPartSchema = z.object({
    type: z.literal("tool_result"),
    tool_result: z.object({
        tool_call_id: z.string(),
        name: z.string().optional(),
        content: z.string(),
        is_error: z.boolean().optional(),
        source: z.string().optional(),
    }),
});

export const contentPartSchema = z.discriminatedUnion("type", [
    textPartSchema,
    imageUrlPartSchema,
    filePartSchema,
    toolCallPartSchema,
    toolResultPartSchema,
]);

export const messageContentSchema = z.union([z.string(), z.array(contentPartSchema)]);

export type TextPart = z.infer<typeof textPartSchema>;
export type ImageUrlPart = z.infer<typeof imageUrlPartSchema>;
export type FilePart = z.infer<typeof filePartSchema>;
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type ToolResultPart = z.infer<typeof toolResultPartSchema>;
export type ContentPart = z.infer<typeof contentPartSchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;

// ---- helpers ----

/** Concatenate every text part. Non-text parts contribute nothing.
 *  Used wherever we need a flat string view (log summaries, title
 *  generation, search index). */
export function extractText(content: MessageContent): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .map((p) => (p.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
}

/** True when at least one non-text part is present. */
export function hasAttachments(content: MessageContent): boolean {
    if (typeof content === "string") return false;
    if (!Array.isArray(content)) return false;
    return content.some((p) => p.type !== "text");
}
