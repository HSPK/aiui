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
    /** Assistant turn with tool calls — canonical chat-completion shape:
     *  `{role:"assistant", content:null, tool_calls:[{id, type:"function",
     *   function:{name, arguments}}]}`. Must become Responses
     *  `function_call` items, NOT dropped. */
    tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
    }>;
    /** Tool result turn — `{role:"tool", tool_call_id, content}`. Must
     *  become a Responses `function_call_output` item. */
    tool_call_id?: string;
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

/** Translate a chat message into ONE OR MORE Responses-API input items.
 *  Returns an array so an assistant turn with both text + tool_calls can
 *  emit a message item AND multiple function_call items in order.
 *
 *  Mapping:
 *    - assistant {content, tool_calls} → [message?(text), function_call*]
 *      (function_call items REPLACE chat-completion's nested
 *      `tool_calls` array — the Responses API doesn't accept `tool_calls`
 *      and silently dropping the assistant turn breaks multi-turn replay)
 *    - tool {tool_call_id, content} → [function_call_output]
 *      (Responses doesn't recognise role:"tool"; the canonical pair-up
 *      is `function_call` from the assistant + `function_call_output`
 *      from the runtime, both linked by `call_id`)
 *    - user / system: standard message item, multimodal-aware
 */
function chatMessageToInputItems(m: ChatMessage): Array<Record<string, unknown>> {
    const role = m.role;
    if (!role) return [];

    // Tool result turn → function_call_output. Content is always a
    // plain string (R8 cap enforces 256 KB; flatten just in case the
    // caller passed an array).
    if (role === "tool") {
        const callId = m.tool_call_id;
        if (!callId) return [];
        return [{
            type: "function_call_output",
            call_id: callId,
            output: flattenContent(m.content),
        }];
    }

    // Assistant turn — emit text (if any) + each tool_call as a
    // function_call. Either may be absent independently; both
    // present is the standard "I want to call N tools, here's why"
    // pattern.
    if (role === "assistant") {
        const items: Array<Record<string, unknown>> = [];
        const text = typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content) ? flattenContent(m.content) : "";
        if (text) {
            items.push({
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text }],
            });
        }
        const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
        for (const tc of tcs) {
            if (!tc?.id || !tc.function?.name) continue;
            items.push({
                type: "function_call",
                call_id: tc.id,
                name: tc.function.name,
                arguments: typeof tc.function.arguments === "string"
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments ?? {}),
            });
        }
        return items;
    }

    // User / developer turns — standard message item with multimodal
    // parts. (developer turns are upgraded to system in the wire
    // layer; this branch handles the residual case.)
    const partType = "input_text";
    if (typeof m.content === "string") {
        return [{
            type: "message",
            role,
            content: [{ type: partType, text: m.content }],
        }];
    }
    if (Array.isArray(m.content)) {
        const parts = m.content
            .map((p) => {
                if (typeof p === "string") return { type: partType, text: p };
                const obj = p as {
                    type?: string;
                    text?: string;
                    image_url?: { url?: string; detail?: string } | string;
                    file?: { filename?: string; file_data?: string; file_id?: string };
                };
                if (obj?.type === "image_url" || obj?.image_url) {
                    return { type: "input_image", image_url: obj.image_url };
                }
                if (obj?.type === "file" || obj?.file) {
                    const f = obj.file ?? {};
                    const out: Record<string, unknown> = { type: "input_file" };
                    if (f.filename) out.filename = f.filename;
                    if (f.file_data) out.file_data = f.file_data;
                    if (f.file_id) out.file_id = f.file_id;
                    return out;
                }
                if (typeof obj?.text === "string") return { type: partType, text: obj.text };
                return null;
            })
            .filter(Boolean) as Array<Record<string, unknown>>;
        if (parts.length === 0) return [];
        return [{ type: "message", role, content: parts }];
    }
    return [];
}

/** Translate chat-completion-shape `tools[]` to Responses-API shape.
 *  Chat-completion: `[{type:"function", function:{name, description, parameters, strict?}}]`
 *  Responses:       `[{type:"function", name, description, parameters, strict?}]`
 *  (flatter — fields nested under `function` move to the same level as `type`).
 *
 *  Spread every key on `fn` AFTER the known ones so that fields we
 *  don't model explicitly today (e.g. OpenAI's `strict` for structured
 *  outputs, or any future field) get forwarded losslessly. Without
 *  this, an opted-in `strict: true` would silently disable schema
 *  enforcement when the caller targeted a Responses-routed model. */
function translateTools(rawTools: unknown): unknown {
    if (!Array.isArray(rawTools)) return rawTools;
    return rawTools.map((t) => {
        if (!t || typeof t !== "object") return t;
        const tool = t as { type?: string; function?: Record<string, unknown> };
        if (tool.type !== "function" || !tool.function) return t;
        const fn = tool.function;
        return { type: "function", ...fn };
    });
}

/** Translate chat-completion-shape `tool_choice` to Responses-API shape.
 *  Chat-completion: `"none" | "auto" | "required" | {type:"function", function:{name}}`
 *  Responses:       `"none" | "auto" | "required" | {type:"function", name}`
 *  (flatter — `function.name` moves to a top-level `name` field).
 *  String forms pass through unchanged. Unknown shapes pass through
 *  losslessly so future OpenAI additions (e.g. {type:"file_search"})
 *  don't get clobbered. */
function translateToolChoice(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") return raw;
    const tc = raw as { type?: unknown; function?: { name?: unknown } & Record<string, unknown> };
    if (tc.type !== "function" || !tc.function || typeof tc.function !== "object") return raw;
    const { function: fn, ...rest } = tc;
    return { ...rest, type: "function", ...fn };
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
        inputItems.push(...chatMessageToInputItems(m));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
        if (FIELDS_NOT_FOR_RESPONSES.has(k)) continue;
        out[k] = v;
    }

    out.input = inputItems;

    // Translate tools[] from chat-completion's nested
    // `{type:"function", function:{...}}` shape to Responses' flatter
    // `{type:"function", name, description, parameters}` shape.
    if (Array.isArray(body.tools)) {
        out.tools = translateTools(body.tools);
    }

    // Same flattening for tool_choice — Responses wants the object
    // shape `{type:"function", name}` while chat-completion uses the
    // nested `{type:"function", function:{name}}`. Without this, a
    // caller that explicitly names a function would 400 at the
    // upstream ("`tool_choice.function`: extra inputs not permitted"
    // or "missing `name`").
    if (body.tool_choice !== undefined) {
        out.tool_choice = translateToolChoice(body.tool_choice);
    }

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

interface AssembledToolCall {
    id: string;
    name: string;
    arguments: string;
}

function extractFromOutput(output: ResponsesOutputItem[] | undefined): {
    content: string;
    reasoning: string;
    toolCalls: AssembledToolCall[];
} {
    let content = "";
    let reasoning = "";
    const toolCalls: AssembledToolCall[] = [];
    if (!Array.isArray(output)) return { content, reasoning, toolCalls };
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
        } else if (item?.type === "function_call") {
            // Responses-API tool call. Mirror chat.completions' tool_calls
            // shape so the gateway's orchestrator (which expects the
            // canonical chat-completion contract) dispatches the call.
            // Without this, the model's tool requests are silently
            // dropped and the loop never enters the tool branch.
            const it = item as unknown as {
                call_id?: string;
                id?: string;
                name?: string;
                arguments?: unknown;
            };
            const callId = it.call_id ?? it.id;
            if (typeof callId !== "string" || typeof it.name !== "string") continue;
            const args = typeof it.arguments === "string"
                ? it.arguments
                : JSON.stringify(it.arguments ?? {});
            toolCalls.push({ id: callId, name: it.name, arguments: args });
        }
    }
    return { content, reasoning, toolCalls };
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
    toolCalls: AssembledToolCall[],
): Record<string, unknown> {
    const message: Record<string, unknown> = { role: "assistant", content };
    if (reasoning) message.reasoning_content = reasoning;
    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
        }));
    }
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
                finish_reason: chatFinishReason(r.status, toolCalls.length > 0),
            },
        ],
    };
    if (usage) out.usage = usage;
    return out;
}

/** Map a Responses-API `status` onto the chat-completions `finish_reason`
 *  enum. This value is returned verbatim to callers as the HTTP body, so it
 *  must stay inside the set OpenAI SDKs accept — `stop | length |
 *  tool_calls | content_filter | function_call`. Leaking a raw Responses
 *  status such as `"incomplete"` makes strict clients reject the reply.
 *
 *  `tool_calls` wins over status: it is the canonical signal that the model
 *  wants to invoke a tool. `incomplete` means the output was cut short,
 *  which is exactly what `length` means in chat-completions. Anything else
 *  unrecognised degrades to `stop` rather than passing through. */
function chatFinishReason(status: string | undefined, hasToolCalls: boolean): string {
    if (hasToolCalls) return "tool_calls";
    if (status === "incomplete") return "length";
    if (status === "content_filter") return "content_filter";
    return "stop";
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
        const { content, reasoning, toolCalls } = extractFromOutput(r.output);
        const usage = r.usage ?? {};
        // Mirror the streaming path's failure detection: a non-stream
        // /v1/responses can also come back as HTTP 200 with `status:
        // Mirror the streaming path's failure detection: a non-stream
        // /v1/responses can also come back as HTTP 200 with `status:
        // "failed"` or `"incomplete"`. Surface that as `error` so the
        // gateway logs the row as failed AND the FE shows a retry
        // affordance — same UX gap R13 closed for streaming.
        //
        // EXCEPT `incomplete_details.reason: "max_output_tokens"` —
        // hitting the caller-supplied token cap is a VALID partial
        // completion (the OpenAI Responses-API analog of chat-
        // completions `finish_reason: "length"`), NOT an upstream
        // failure. Treating it as error makes the FE pop a retry card
        // on every cap-bounded reply — the user retries, hits the
        // cap again, retries forever. Only true failures (content
        // filter, server errors) should mark the row failed.
        let error: string | undefined;
        if (r.status === "failed") {
            const errMsg = (r as { error?: { message?: unknown } }).error?.message;
            error = typeof errMsg === "string" ? errMsg : "response.failed";
        } else if (r.status === "incomplete") {
            const reason = (r as { incomplete_details?: { reason?: unknown } }).incomplete_details?.reason;
            if (typeof reason === "string" && reason !== "max_output_tokens") {
                error = `incomplete: ${reason}`;
            }
            // max_output_tokens or missing reason → not an error;
            // finishReason="length" below tells the FE it was capped.
        }
        return {
            output: content || null,
            promptTokens: usage.input_tokens ?? null,
            completionTokens: usage.output_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            normalized: toChatCompletion(r, content, reasoning, toolCalls),
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            // Same mapping as the embedded `normalized.choices[0].finish_reason`
            // above. These two must never disagree: the streaming path feeds
            // this one into `onComplete` and the terminal SSE chunk, so a raw
            // Responses status here would surface a non-standard value to the
            // playground orchestrator even though the HTTP body was correct.
            finishReason: chatFinishReason(r.status, toolCalls.length > 0),
            error,
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

        // Tool-call stream: Responses emits the function_call shell
        // first (`output_item.added` carries `item.type === "function_call"`,
        // call_id and name), then per-arg-chunk
        // `function_call_arguments.delta`. Map both into the gateway's
        // canonical `{index, id, name, argumentsDelta}` shape so
        // `toolAcc` accumulates correctly and the orchestrator enters
        // the tool branch on terminal `tool_calls` finish_reason.
        // Without this, the model's tool requests are silently dropped
        // mid-stream.
        if (type === "response.output_item.added") {
            const item = ev.item as unknown as {
                type?: string;
                call_id?: string;
                id?: string;
                name?: string;
            } | undefined;
            const outIdx = (ev as { output_index?: number }).output_index;
            if (item?.type === "function_call" && typeof outIdx === "number") {
                return {
                    content: "",
                    reasoning: "",
                    toolCalls: [{
                        index: outIdx,
                        id: item.call_id ?? item.id,
                        name: item.name,
                        argumentsDelta: "",
                    }],
                };
            }
            return null;
        }

        if (type === "response.function_call_arguments.delta") {
            const outIdx = (ev as { output_index?: number }).output_index;
            const delta = typeof ev.delta === "string" ? ev.delta : "";
            if (typeof outIdx !== "number" || !delta) return null;
            return {
                content: "",
                reasoning: "",
                toolCalls: [{ index: outIdx, argumentsDelta: delta }],
            };
        }

        // Terminal event carries the final usage + canonical id/model.
        // ALSO derive `finishReason: "tool_calls"` when the assembled
        // output array contains function_call items — without this the
        // gateway falls back to "stop" and never dispatches the call.
        if (type === "response.completed") {
            const r = ev.response;
            const hasToolCalls = Array.isArray(r?.output) &&
                r!.output!.some((it) => (it as { type?: string })?.type === "function_call");
            return {
                content: "",
                reasoning: "",
                id: typeof r?.id === "string" ? r.id : undefined,
                model: typeof r?.model === "string" ? r.model : undefined,
                usage: normalizeUsage(r?.usage) ?? undefined,
                finishReason: hasToolCalls ? "tool_calls" : "stop",
            };
        }

        if (type === "response.failed" || type === "response.incomplete") {
            // Surface as a terminal-error delta so the gateway's
            // streaming finalize() marks the log as "failed". Without
            // an explicit error signal, the gateway would treat
            // absence of finishReason as a clean "stop" and persist
            // the row as `completed` — masking real upstream failures.
            //
            // EXCEPT `response.incomplete` with reason
            // `max_output_tokens` — hitting the caller-supplied token
            // cap is a VALID partial completion (chat-completions
            // analog: finish_reason="length"). Treating it as failure
            // pops a retry card on every cap-bounded reply; the user
            // retries, hits the cap again, retries forever.
            const r = ev.response;
            const incReason = (r as { incomplete_details?: { reason?: unknown } } | undefined)?.incomplete_details?.reason;
            const isCapHit = type === "response.incomplete" && incReason === "max_output_tokens";

            const reasonText = (() => {
                if (type === "response.failed") {
                    const err = (r as { error?: { message?: unknown } } | undefined)?.error;
                    return typeof err?.message === "string" ? err.message : "response.failed";
                }
                return typeof incReason === "string" ? `incomplete: ${incReason}` : "response.incomplete";
            })();
            return {
                content: "",
                reasoning: "",
                id: typeof r?.id === "string" ? r.id : undefined,
                model: typeof r?.model === "string" ? r.model : undefined,
                usage: normalizeUsage(r?.usage) ?? undefined,
                finishReason: type === "response.incomplete" ? "length" : "stop",
                error: isCapHit ? undefined : { reason: reasonText },
            };
        }

        // Housekeeping events (output_item.added, content_part.added,
        // done variants for items/parts, etc.) carry no content delta.
        return null;
    },
};

registerVariant(responsesVariant);
