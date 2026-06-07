import "server-only";
import { registerVariant, type UpstreamApiVariant } from ".";

/**
 * /v1/responses — OpenAI Responses API. Different shape on every axis:
 *
 *   Request:  { input: [...], instructions, max_output_tokens, ... }
 *             vs chat:  { messages: [...], max_tokens, ... }
 *   Response: { output: [{type:"message", content:[{type:"output_text", text}]}],
 *               usage: { input_tokens, output_tokens, total_tokens } }
 *             vs chat: { choices:[{message:{content}}], usage:{prompt_tokens,...} }
 *   Stream:   typed events `response.output_text.delta`, `response.reasoning_summary_text.delta`,
 *             `response.completed`, …
 *             vs chat: `data: {choices:[{delta:{content}}]}` lines with `[DONE]` terminator
 *
 * The gateway speaks chat-completion as its internal canonical form, so
 * this variant translates chat → responses on the way out and responses
 * → chat on the way back.
 */

interface ChatMessage {
    role?: string;
    content?: unknown;
    name?: string;
    [k: string]: unknown;
}

interface ResponsesUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [k: string]: unknown;
}

interface ResponsesOutputItem {
    type?: string;
    role?: string;
    content?: Array<{
        type?: string;
        text?: string;
        annotations?: unknown[];
    }>;
    summary?: Array<{ type?: string; text?: string }>;
    [k: string]: unknown;
}

interface ResponsesResponse {
    id?: string;
    model?: string;
    status?: string;
    created_at?: number;
    output?: ResponsesOutputItem[];
    usage?: ResponsesUsage;
    [k: string]: unknown;
}

interface ResponsesStreamEvent {
    type?: string;
    delta?: unknown;
    response?: ResponsesResponse;
    item?: ResponsesOutputItem;
    [k: string]: unknown;
}

// =============================================================================
// Request translation: chat-completion → responses
// =============================================================================

function flattenContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((p) => {
                if (typeof p === "string") return p;
                const obj = p as { text?: string; type?: string };
                return typeof obj?.text === "string" ? obj.text : "";
            })
            .filter(Boolean)
            .join("");
    }
    return "";
}

/** Translate a chat message into a Responses-API input item. The Responses
 *  API expects message items shaped like
 *  `{ type: "message", role, content: [{type: "input_text"|"output_text", text}] }`. */
function chatMessageToInputItem(m: ChatMessage): Record<string, unknown> | null {
    const role = m.role;
    if (!role) return null;
    const isAssistant = role === "assistant";
    const partType = isAssistant ? "output_text" : "input_text";

    if (typeof m.content === "string") {
        return {
            type: "message",
            role,
            content: [{ type: partType, text: m.content }],
        };
    }
    if (Array.isArray(m.content)) {
        const parts = m.content
            .map((p) => {
                if (typeof p === "string") return { type: partType, text: p };
                const obj = p as { type?: string; text?: string; image_url?: unknown };
                // Multi-modal: image_url passes through with its Responses-equivalent type.
                if (obj?.image_url) return { type: "input_image", image_url: obj.image_url };
                if (typeof obj?.text === "string") return { type: partType, text: obj.text };
                return null;
            })
            .filter(Boolean);
        if (parts.length === 0) return null;
        return { type: "message", role, content: parts };
    }
    return null;
}

const FIELDS_NOT_FOR_RESPONSES = new Set([
    "messages",
    "max_tokens",
    "max_completion_tokens",
    "stream_options", // chat-only; Responses streams usage in response.completed
    "logprobs",
    "top_logprobs",
    "n", // Responses produces one response
    "frequency_penalty",
    "presence_penalty",
    "logit_bias",
    "stop", // Responses has no direct equivalent; drop silently
    "response_format", // Replaced by `text.format` below
    "function_call", // Legacy alias
    "functions", // Legacy alias
]);

function translateRequest(body: Record<string, unknown>): Record<string, unknown> {
    const messages = (body.messages ?? []) as ChatMessage[];

    const instructions: string[] = [];
    const inputItems: Array<Record<string, unknown>> = [];
    for (const m of messages) {
        if (m.role === "system" || m.role === "developer") {
            const t = flattenContent(m.content);
            if (t) instructions.push(t);
            continue;
        }
        const item = chatMessageToInputItem(m);
        if (item) inputItems.push(item);
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
        if (FIELDS_NOT_FOR_RESPONSES.has(k)) continue;
        out[k] = v;
    }

    out.input = inputItems;

    // System messages → `instructions`, merged with any explicit one in body.
    const existingInstructions = typeof body.instructions === "string" ? body.instructions : "";
    const merged = [existingInstructions, ...instructions].filter(Boolean).join("\n\n");
    if (merged) out.instructions = merged;

    // Token cap: prefer the most specific caller-supplied value.
    const cap =
        (body.max_output_tokens as number | undefined) ??
        (body.max_completion_tokens as number | undefined) ??
        (body.max_tokens as number | undefined);
    if (cap != null) out.max_output_tokens = cap;

    // Translate response_format → text.format. OpenAI Responses uses
    // `text: {format: {type: "json_schema"|"text", ...}}`.
    const rf = body.response_format as Record<string, unknown> | undefined;
    if (rf) {
        const existingText = (out.text as Record<string, unknown>) ?? {};
        out.text = { ...existingText, format: rf };
    }

    // `stream` flag passes through.
    return out;
}

// =============================================================================
// Response parsing
// =============================================================================

function extractText(output: ResponsesOutputItem[] | undefined): { content: string; reasoning: string } {
    let content = "";
    let reasoning = "";
    if (!Array.isArray(output)) return { content, reasoning };
    for (const item of output) {
        if (item?.type === "message") {
            for (const part of item.content ?? []) {
                if (part?.type === "output_text" && typeof part.text === "string") {
                    content += part.text;
                }
            }
        } else if (item?.type === "reasoning") {
            const summary = item.summary;
            if (Array.isArray(summary)) {
                for (const s of summary) {
                    if (s?.type === "summary_text" && typeof s.text === "string") {
                        reasoning += s.text;
                    }
                }
            }
        }
    }
    return { content, reasoning };
}

function normalizeUsage(u: ResponsesUsage | undefined): Record<string, unknown> | null {
    if (!u) return null;
    return {
        prompt_tokens: u.input_tokens ?? null,
        completion_tokens: u.output_tokens ?? null,
        total_tokens: u.total_tokens ?? null,
        // Preserve everything else (cached/prompt detail blocks, etc.).
        ...u,
    };
}

function toChatCompletion(
    r: ResponsesResponse,
    content: string,
    reasoning: string,
): Record<string, unknown> {
    const message: Record<string, unknown> = { role: "assistant", content };
    if (reasoning) message.reasoning_content = reasoning;
    const usage = normalizeUsage(r.usage);
    const out: Record<string, unknown> = {
        id: r.id ?? "",
        object: "chat.completion",
        created: typeof r.created_at === "number" ? r.created_at : Math.floor(Date.now() / 1000),
        model: r.model ?? "",
        choices: [
            {
                index: 0,
                message,
                finish_reason: r.status === "completed" ? "stop" : (r.status ?? "stop"),
            },
        ],
    };
    if (usage) out.usage = usage;
    return out;
}

// =============================================================================
// Variant export
// =============================================================================

export const responsesVariant: UpstreamApiVariant = {
    id: "responses",
    capability: "chat",
    path: "/responses",
    supportsStreaming: true,

    transformRequest(body) {
        return translateRequest(body);
    },

    parseResponse(json) {
        const r = (json ?? {}) as ResponsesResponse;
        const { content, reasoning } = extractText(r.output);
        const usage = r.usage ?? {};
        return {
            output: content || null,
            promptTokens: usage.input_tokens ?? null,
            completionTokens: usage.output_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            normalized: toChatCompletion(r, content, reasoning),
        };
    },

    parseStreamChunk(json) {
        const ev = (json ?? {}) as ResponsesStreamEvent;
        const type = ev.type;
        if (!type) return null;

        // Lifecycle: capture id/model when the response is created or finalized.
        if (type === "response.created" || type === "response.in_progress") {
            const r = ev.response;
            return {
                content: "",
                reasoning: "",
                id: typeof r?.id === "string" ? r.id : undefined,
                model: typeof r?.model === "string" ? r.model : undefined,
            };
        }

        // Textual content delta.
        if (type === "response.output_text.delta") {
            const delta = typeof ev.delta === "string" ? ev.delta : "";
            return { content: delta, reasoning: "" };
        }

        // Reasoning deltas land under several event names depending on
        // model family — catch them all.
        if (
            type === "response.reasoning_summary_text.delta" ||
            type === "response.reasoning_summary.delta" ||
            type === "response.reasoning.delta"
        ) {
            const delta = typeof ev.delta === "string" ? ev.delta : "";
            return { content: "", reasoning: delta };
        }

        // Terminal event carries the final usage + canonical id/model.
        if (type === "response.completed") {
            const r = ev.response;
            return {
                content: "",
                reasoning: "",
                id: typeof r?.id === "string" ? r.id : undefined,
                model: typeof r?.model === "string" ? r.model : undefined,
                usage: normalizeUsage(r?.usage) ?? undefined,
            };
        }

        if (type === "response.failed" || type === "response.incomplete") {
            // Surface as an empty terminal — the gateway logs the upstream
            // error separately via HTTP status if any.
            const r = ev.response;
            return {
                content: "",
                reasoning: "",
                id: typeof r?.id === "string" ? r.id : undefined,
                model: typeof r?.model === "string" ? r.model : undefined,
                usage: normalizeUsage(r?.usage) ?? undefined,
            };
        }

        // Housekeeping events (output_item.added, content_part.added,
        // done variants for items/parts, etc.) carry no content delta.
        return null;
    },
};

registerVariant(responsesVariant);
