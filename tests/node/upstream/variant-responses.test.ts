import { describe, expect, it } from "vitest";
import { responsesVariant } from "@/lib/server/api-variants/responses";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel(),
    meta: null,
    capability: getCapability("chat")!,
    stream: false,
};

function transform(body: Record<string, unknown>) {
    return responsesVariant.transformRequest!(body, ctx);
}

describe("api-variants/responses — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(responsesVariant.id).toBe("responses");
        expect(responsesVariant.capability).toBe("chat");
        expect(responsesVariant.path).toBe("/responses");
        expect(responsesVariant.supportsStreaming).toBe(true);
    });
});

describe("api-variants/responses — transformRequest: messages → input / instructions", () => {
    it("moves system messages into `instructions`, dropping the `messages` key", () => {
        const out = transform({ messages: [{ role: "system", content: "Be terse." }, { role: "user", content: "Hi" }] });
        expect(out.instructions).toBe("Be terse.");
        expect(out).not.toHaveProperty("messages");
        expect(out.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] }]);
    });

    it("treats developer messages the same as system messages", () => {
        const out = transform({ messages: [{ role: "developer", content: "dev instructions" }] });
        expect(out.instructions).toBe("dev instructions");
    });

    it("merges multiple system/developer messages, in order, joined by blank lines", () => {
        const out = transform({
            messages: [
                { role: "system", content: "first" },
                { role: "developer", content: "second" },
            ],
        });
        expect(out.instructions).toBe("first\n\nsecond");
    });

    it("prepends any explicit body.instructions before message-derived instructions", () => {
        const out = transform({ instructions: "explicit", messages: [{ role: "system", content: "from message" }] });
        expect(out.instructions).toBe("explicit\n\nfrom message");
    });

    it("omits `instructions` entirely when there is nothing to say", () => {
        const out = transform({ messages: [{ role: "user", content: "hi" }] });
        expect(out).not.toHaveProperty("instructions");
    });

    it("translates an assistant text-only turn to a message item", () => {
        const out = transform({ messages: [{ role: "assistant", content: "Sure, here you go." }] });
        expect(out.input).toEqual([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Sure, here you go." }] }]);
    });

    it("flattens assistant array-shaped content (not just strings) into the message item's text", () => {
        const out = transform({ messages: [{ role: "assistant", content: [{ text: "part1" }, "part2"] as unknown as string }] });
        expect(out.input).toEqual([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "part1part2" }] }]);
    });

    it("translates an assistant tool_calls-only turn (content:null) to function_call items, no message item", () => {
        const out = transform({
            messages: [
                {
                    role: "assistant",
                    content: null,
                    tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } }],
                },
            ],
        });
        expect(out.input).toEqual([{ type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"NYC"}' }]);
    });

    it("translates an assistant turn with BOTH text and tool_calls into a message item followed by function_call items, in order", () => {
        const out = transform({
            messages: [
                {
                    role: "assistant",
                    content: "Let me check.",
                    tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } }],
                },
            ],
        });
        expect(out.input).toEqual([
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "Let me check." }] },
            { type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{}" },
        ]);
    });

    it("JSON-stringifies non-string tool_call arguments", () => {
        const out = transform({
            messages: [
                { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "f", arguments: { a: 1 } as unknown as string } }] },
            ],
        });
        expect((out.input as Array<Record<string, unknown>>)[0].arguments).toBe('{"a":1}');
    });

    it("defaults tool_call arguments to '{}' when the function block omits `arguments` entirely", () => {
        const out = transform({
            messages: [{ role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "f" } }] }],
        });
        expect((out.input as Array<Record<string, unknown>>)[0].arguments).toBe("{}");
    });

    it("skips tool_calls missing id or function.name", () => {
        const out = transform({
            messages: [
                {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        { id: "c1", function: {} }, // no name
                        { function: { name: "f2" } }, // no id
                    ],
                },
            ],
        });
        expect(out.input).toEqual([]);
    });

    it("produces NO input item for an assistant turn with neither text nor tool_calls", () => {
        const out = transform({ messages: [{ role: "assistant", content: null }] });
        expect(out.input).toEqual([]);
    });

    it("translates a tool-result turn to function_call_output", () => {
        const out = transform({ messages: [{ role: "tool", tool_call_id: "call_1", content: "72°F and sunny" }] });
        expect(out.input).toEqual([{ type: "function_call_output", call_id: "call_1", output: "72°F and sunny" }]);
    });

    it("drops a tool-result turn missing tool_call_id", () => {
        const out = transform({ messages: [{ role: "tool", content: "orphaned result" }] });
        expect(out.input).toEqual([]);
    });

    it("flattens array tool-result content without a separator", () => {
        const out = transform({
            messages: [{ role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "part1" }, "part2"] }],
        });
        expect((out.input as Array<Record<string, unknown>>)[0].output).toBe("part1part2");
    });

    it("drops content-array parts that are textless objects or nullish, without throwing", () => {
        const out = transform({
            messages: [{
                role: "tool",
                tool_call_id: "call_1",
                content: [{ text: "kept" }, { type: "image_url" }, null, undefined] as unknown as string,
            }],
        });
        expect((out.input as Array<Record<string, unknown>>)[0].output).toBe("kept");
    });

    it("flattens to an empty string when tool-result content is neither a string nor an array", () => {
        const missing = transform({ messages: [{ role: "tool", tool_call_id: "call_1", content: undefined as unknown as string }] });
        expect((missing.input as Array<Record<string, unknown>>)[0].output).toBe("");

        const numeric = transform({ messages: [{ role: "tool", tool_call_id: "call_1", content: 42 as unknown as string }] });
        expect((numeric.input as Array<Record<string, unknown>>)[0].output).toBe("");
    });

    it("translates a multimodal user turn: text + image_url + file parts", () => {
        const out = transform({
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "what is this?" },
                        { type: "image_url", image_url: { url: "https://x/img.png", detail: "high" } },
                        { type: "file", file: { filename: "a.pdf", file_data: "data:application/pdf;base64,AAA" } },
                    ],
                },
            ],
        });
        expect(out.input).toEqual([
            {
                type: "message",
                role: "user",
                content: [
                    { type: "input_text", text: "what is this?" },
                    { type: "input_image", image_url: { url: "https://x/img.png", detail: "high" } },
                    { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,AAA" },
                ],
            },
        ]);
    });

    it("maps bare content-part strings within an array to input_text", () => {
        const out = transform({ messages: [{ role: "user", content: ["plain string part"] }] });
        expect(out.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "plain string part" }] }]);
    });

    it("recognizes a file part via the bare `file` key alone (no explicit type:'file')", () => {
        const out = transform({
            messages: [{ role: "user", content: [{ file: { file_id: "file-abc" } }] }],
        });
        expect(out.input).toEqual([
            { type: "message", role: "user", content: [{ type: "input_file", file_id: "file-abc" }] },
        ]);
    });

    it("emits a bare {type:'input_file'} when a file part has no filename/file_data/file_id", () => {
        const out = transform({ messages: [{ role: "user", content: [{ type: "file" }] }] });
        expect(out.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_file" }] }]);
    });

    it("drops unrecognized content parts, and drops the whole message when nothing survives", () => {
        const out = transform({ messages: [{ role: "user", content: [{ type: "unknown_part" }] }] });
        expect(out.input).toEqual([]);
    });

    it("produces no input item for a user message whose content is neither a string nor an array", () => {
        const out = transform({ messages: [{ role: "user", content: 42 as unknown as string }] });
        expect(out.input).toEqual([]);
    });

    it("drops a message with no role at all", () => {
        const out = transform({ messages: [{ content: "no role here" }] });
        expect(out.input).toEqual([]);
    });

    it("defaults input to [] when body has no messages", () => {
        expect(transform({}).input).toEqual([]);
    });

    it("does not push an instructions entry for a system message that flattens to an empty string", () => {
        const out = transform({ messages: [{ role: "system", content: [] }, { role: "user", content: "hi" }] });
        expect(out).not.toHaveProperty("instructions");
    });
});

describe("api-variants/responses — transformRequest: tools / tool_choice", () => {
    it("flattens chat-completion tool defs into the Responses shape", () => {
        const out = transform({
            tools: [{ type: "function", function: { name: "get_weather", description: "desc", parameters: { type: "object" }, strict: true } }],
        });
        expect(out.tools).toEqual([{ type: "function", name: "get_weather", description: "desc", parameters: { type: "object" }, strict: true }]);
    });

    it("passes through non-function tool entries unchanged", () => {
        const weirdTool = { type: "file_search" };
        const out = transform({ tools: [weirdTool] });
        expect(out.tools).toEqual([weirdTool]);
    });

    it("passes through a function-type tool with no `function` block unchanged", () => {
        const bareTool = { type: "function" };
        const out = transform({ tools: [bareTool] });
        expect(out.tools).toEqual([bareTool]);
    });

    it("passes through non-object tool array entries unchanged", () => {
        const out = transform({ tools: [null, "not-an-object"] });
        expect(out.tools).toEqual([null, "not-an-object"]);
    });

    it("passes a non-array `tools` value through untranslated", () => {
        const out = transform({ tools: "not-an-array" });
        expect(out.tools).toBe("not-an-array");
    });

    it("omits `tools` entirely when absent from the body", () => {
        expect(transform({})).not.toHaveProperty("tools");
    });

    it("flattens an object tool_choice, preserving extra keys and letting `function` fields win", () => {
        const out = transform({ tool_choice: { type: "function", function: { name: "get_weather" }, some_extra: "x" } });
        expect(out.tool_choice).toEqual({ some_extra: "x", type: "function", name: "get_weather" });
    });

    it("passes through string tool_choice values unchanged", () => {
        for (const v of ["none", "auto", "required"]) {
            expect(transform({ tool_choice: v }).tool_choice).toBe(v);
        }
    });

    it("passes through a non-function object tool_choice unchanged", () => {
        const tc = { type: "allowed_tools", mode: "auto" };
        expect(transform({ tool_choice: tc }).tool_choice).toEqual(tc);
    });

    it("omits tool_choice entirely when the caller didn't set it", () => {
        expect(transform({})).not.toHaveProperty("tool_choice");
    });
});

describe("api-variants/responses — transformRequest: field drops & token cap cascade", () => {
    it("drops chat-only fields with no Responses equivalent", () => {
        const out = transform({
            max_tokens: 100,
            max_completion_tokens: 200,
            stream_options: { include_usage: true },
            logprobs: true,
            top_logprobs: 3,
            n: 2,
            frequency_penalty: 0.1,
            presence_penalty: 0.1,
            logit_bias: { "50256": -100 },
            stop: ["\n"],
            function_call: "auto",
            functions: [],
        });
        for (const key of [
            "max_completion_tokens", "stream_options", "logprobs", "top_logprobs", "n",
            "frequency_penalty", "presence_penalty", "logit_bias", "stop", "function_call", "functions",
        ]) {
            expect(out).not.toHaveProperty(key);
        }
    });

    it("passes arbitrary non-excluded fields straight through", () => {
        const out = transform({ temperature: 0.5, top_p: 0.9, seed: 42, user: "u1", stream: true });
        expect(out).toMatchObject({ temperature: 0.5, top_p: 0.9, seed: 42, user: "u1", stream: true });
    });

    it("prefers max_output_tokens, then max_completion_tokens, then max_tokens", () => {
        expect(transform({ max_output_tokens: 100, max_completion_tokens: 200, max_tokens: 300 }).max_output_tokens).toBe(100);
        expect(transform({ max_completion_tokens: 200, max_tokens: 300 }).max_output_tokens).toBe(200);
        expect(transform({ max_tokens: 300 }).max_output_tokens).toBe(300);
    });

    it("omits max_output_tokens entirely when no cap is supplied", () => {
        expect(transform({})).not.toHaveProperty("max_output_tokens");
    });

    it("treats 0 as a real cap value, not a missing one", () => {
        expect(transform({ max_tokens: 0 }).max_output_tokens).toBe(0);
    });
});

describe("api-variants/responses — transformRequest: response_format → text.format", () => {
    it("wraps response_format under text.format", () => {
        const rf = { type: "json_schema", json_schema: { name: "x", schema: {} } };
        const out = transform({ response_format: rf });
        expect(out.text).toEqual({ format: rf });
        expect(out).not.toHaveProperty("response_format");
    });

    it("merges into an existing `text` object rather than clobbering it", () => {
        const rf = { type: "text" };
        const out = transform({ text: { verbosity: "low" }, response_format: rf });
        expect(out.text).toEqual({ verbosity: "low", format: rf });
    });

    it("leaves an existing `text` field alone when response_format is absent", () => {
        const out = transform({ text: { verbosity: "low" } });
        expect(out.text).toEqual({ verbosity: "low" });
    });
});

// ---------------------------------------------------------------------------
// parseResponse
// ---------------------------------------------------------------------------

describe("api-variants/responses — parseResponse: content/reasoning/tool_calls extraction", () => {
    it("extracts output_text from a message item", () => {
        const result = responsesVariant.parseResponse(
            { id: "resp_1", model: "gpt-5", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Hello!" }] }] },
            ctx,
        );
        expect(result.output).toBe("Hello!");
        expect(result.finishReason).toBe("stop");
        expect(result.error).toBeUndefined();
    });

    it("concatenates text across multiple message items with no separator", () => {
        const result = responsesVariant.parseResponse(
            {
                status: "completed",
                output: [
                    { type: "message", content: [{ type: "output_text", text: "Hello " }] },
                    { type: "message", content: [{ type: "output_text", text: "world" }] },
                ],
            },
            ctx,
        );
        expect(result.output).toBe("Hello world");
    });

    it("extracts reasoning summary text", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "thinking step" }] }] },
            ctx,
        );
        expect(result.normalized.choices as unknown[]).toBeDefined();
        const message = (result.normalized.choices as Array<{ message: Record<string, unknown> }>)[0].message;
        expect(message.reasoning_content).toBe("thinking step");
    });

    it("tolerates a reasoning item with no summary array", () => {
        const result = responsesVariant.parseResponse({ status: "completed", output: [{ type: "reasoning" }] }, ctx);
        expect(result.output).toBeNull();
    });

    it("assembles function_call items into tool_calls, preferring call_id over id", () => {
        const result = responsesVariant.parseResponse(
            {
                status: "completed",
                output: [{ type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"NYC"}' }],
            },
            ctx,
        );
        expect(result.toolCalls).toEqual([{ id: "call_1", name: "get_weather", arguments: '{"city":"NYC"}' }]);
        expect(result.finishReason).toBe("tool_calls");
    });

    it("falls back to `id` when `call_id` is absent on a function_call item", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "function_call", id: "fc_1", name: "get_weather", arguments: "{}" }] },
            ctx,
        );
        expect(result.toolCalls).toEqual([{ id: "fc_1", name: "get_weather", arguments: "{}" }]);
    });

    it("JSON-stringifies non-string function_call arguments, defaulting to {} when absent", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "f" }] },
            ctx,
        );
        expect(result.toolCalls).toEqual([{ id: "c1", name: "f", arguments: "{}" }]);
    });

    it("skips function_call items missing a resolvable call id or a string name", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "function_call", name: "f" }, { type: "function_call", call_id: "c1" }] },
            ctx,
        );
        expect(result.toolCalls).toBeUndefined();
    });

    it("ignores unrecognized output item types without throwing", () => {
        const result = responsesVariant.parseResponse({ status: "completed", output: [{ type: "web_search_call" }] }, ctx);
        expect(result.output).toBeNull();
        expect(result.toolCalls).toBeUndefined();
    });

    it("ignores a message content part that isn't a string-text output_text part", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "can't help with that" }] }] },
            ctx,
        );
        expect(result.output).toBeNull();
    });

    it("treats a message item with no `content` array as contributing no text", () => {
        const result = responsesVariant.parseResponse({ status: "completed", output: [{ type: "message" }] }, ctx);
        expect(result.output).toBeNull();
    });

    it("ignores a reasoning summary entry that isn't a string-text summary_text part", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "reasoning", summary: [{ type: "other", text: 5 as unknown as string }] }] },
            ctx,
        );
        const message = (result.normalized.choices as Array<{ message: Record<string, unknown> }>)[0].message;
        expect("reasoning_content" in message).toBe(false);
    });

    it("handles a completely absent `output` array", () => {
        const result = responsesVariant.parseResponse({ status: "completed" }, ctx);
        expect(result.output).toBeNull();
    });

    it("handles a null json body without throwing, and defaults `created` to the current time", () => {
        const before = Math.floor(Date.now() / 1000);
        const result = responsesVariant.parseResponse(null, ctx);
        expect(result.output).toBeNull();
        expect(result.normalized.created as number).toBeGreaterThanOrEqual(before);
    });

    it("uses the upstream `created_at` verbatim when it is a number", () => {
        const result = responsesVariant.parseResponse({ status: "completed", created_at: 1700000000, output: [] }, ctx);
        expect(result.normalized.created).toBe(1700000000);
    });

    it("includes reasoning_content on the assistant message only when reasoning is non-empty", () => {
        const withReasoning = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "r" }] }, { type: "message", content: [{ type: "output_text", text: "hi" }] }] },
            ctx,
        );
        const msgWith = (withReasoning.normalized.choices as Array<{ message: Record<string, unknown> }>)[0].message;
        expect(msgWith.reasoning_content).toBe("r");

        const withoutReasoning = responsesVariant.parseResponse(
            { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }] },
            ctx,
        );
        const msgWithout = (withoutReasoning.normalized.choices as Array<{ message: Record<string, unknown> }>)[0].message;
        expect("reasoning_content" in msgWithout).toBe(false);
    });
});

describe("api-variants/responses — parseResponse: usage normalization", () => {
    it("maps input_tokens/output_tokens/total_tokens to prompt/completion/total", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } },
            ctx,
        );
        expect(result.promptTokens).toBe(10);
        expect(result.completionTokens).toBe(20);
        expect(result.totalTokens).toBe(30);
        expect(result.normalized.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, input_tokens: 10, output_tokens: 20 });
    });

    it("preserves extra usage detail blocks via the passthrough spread", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 5 } } },
            ctx,
        );
        expect((result.normalized.usage as Record<string, unknown>).input_tokens_details).toEqual({ cached_tokens: 5 });
    });

    it("defaults missing individual usage fields to null rather than dropping them", () => {
        const result = responsesVariant.parseResponse({ status: "completed", output: [], usage: { input_tokens: 10 } }, ctx);
        expect(result.promptTokens).toBe(10);
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
        expect(result.normalized.usage).toEqual({ prompt_tokens: 10, completion_tokens: null, total_tokens: null, input_tokens: 10 });
    });

    it("defaults `prompt_tokens` to null when only completion/total usage fields are present", () => {
        const result = responsesVariant.parseResponse(
            { status: "completed", output: [], usage: { output_tokens: 20, total_tokens: 30 } },
            ctx,
        );
        expect(result.normalized.usage).toEqual({ prompt_tokens: null, completion_tokens: 20, total_tokens: 30, output_tokens: 20 });
    });

    it("omits usage entirely from the normalized response when absent upstream", () => {
        const result = responsesVariant.parseResponse({ status: "completed", output: [] }, ctx);
        expect(result.promptTokens).toBeNull();
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
        expect(result.normalized).not.toHaveProperty("usage");
    });
});

describe("api-variants/responses — parseResponse: failed / incomplete status handling", () => {
    it("surfaces status:failed with an error message", () => {
        const result = responsesVariant.parseResponse({ status: "failed", error: { message: "content policy violation" }, output: [] }, ctx);
        expect(result.error).toBe("content policy violation");
        // finishReason is clamped to the OpenAI enum via chatFinishReason —
        // see the dedicated "chatFinishReason mapping" describe block below
        // for full status × tool-call coverage of this invariant.
        expect(result.finishReason).toBe("stop");
    });

    it("uses a generic marker when status:failed has no string error message", () => {
        const result = responsesVariant.parseResponse({ status: "failed", error: { code: "server_error" }, output: [] }, ctx);
        expect(result.error).toBe("response.failed");
    });

    it("does NOT treat incomplete/max_output_tokens as an error (valid cap-bounded completion)", () => {
        const result = responsesVariant.parseResponse(
            { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }] },
            ctx,
        );
        expect(result.error).toBeUndefined();
        expect(result.finishReason).toBe("length");
    });

    it("treats other incomplete reasons as an error", () => {
        const result = responsesVariant.parseResponse(
            { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] },
            ctx,
        );
        expect(result.error).toBe("incomplete: content_filter");
        expect(result.finishReason).toBe("length");
    });

    it("does not error when incomplete_details.reason is entirely missing", () => {
        const result = responsesVariant.parseResponse({ status: "incomplete", output: [] }, ctx);
        expect(result.error).toBeUndefined();
        expect(result.finishReason).toBe("length");
    });

    /**
     * Regression test for the finish_reason leak (previously
     * lib/server/api-variants/responses.ts:407, toChatCompletion): a capped
     * (`status:"incomplete"`) Responses reply must map to the OpenAI-standard
     * "length" enum value BOTH in the client-facing embedded JSON
     * (`normalized.choices[0].finish_reason`, via the `chatFinishReason()`
     * helper) and in the internal top-level `finishReason` field — the two
     * representations of the same event must agree.
     */
    it("maps a capped (incomplete) response to finish_reason:'length' in both the embedded normalized JSON and the top-level finishReason", () => {
        const result = responsesVariant.parseResponse(
            { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }] },
            ctx,
        );
        const message = (result.normalized.choices as Array<{ finish_reason: string }>)[0];
        expect(message.finish_reason).toBe("length");
        expect(result.finishReason).toBe("length");
        expect(message.finish_reason).toBe(result.finishReason);
    });
});

describe("api-variants/responses — parseResponse: chatFinishReason mapping (top-level finishReason vs embedded finish_reason agreement)", () => {
    function embeddedFinishReason(result: ReturnType<typeof responsesVariant.parseResponse>): string {
        return (result.normalized.choices as Array<{ finish_reason: string }>)[0].finish_reason;
    }

    const NO_OUTPUT: unknown[] = [];
    const TOOL_CALL_OUTPUT = [{ type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{}" }];
    const ALL_STATUSES: Array<string | undefined> = ["completed", "incomplete", "failed", "in_progress", "content_filter", undefined];

    // Both the client-facing embedded `normalized.choices[0].finish_reason`
    // and the internal top-level `finishReason` are now derived from the
    // SAME chatFinishReason(status, hasToolCalls) helper — they must always
    // agree, and the exact mapping below is the documented contract.
    it.each([
        ["completed", "stop"],
        ["incomplete", "length"],
        ["failed", "stop"],
        ["in_progress", "stop"],
        ["content_filter", "content_filter"],
        [undefined, "stop"],
    ])("status:%s (no tool calls) → finish_reason %s, agreeing on both the embedded and top-level fields", (status, expected) => {
        const result = responsesVariant.parseResponse({ status, output: NO_OUTPUT }, ctx);
        expect(embeddedFinishReason(result)).toBe(expected);
        expect(result.finishReason).toBe(expected);
        expect(embeddedFinishReason(result)).toBe(result.finishReason);
    });

    it.each(ALL_STATUSES)("tool_calls present always wins over status:%s → finish_reason 'tool_calls' on both fields", (status) => {
        const result = responsesVariant.parseResponse({ status, output: TOOL_CALL_OUTPUT }, ctx);
        expect(embeddedFinishReason(result)).toBe("tool_calls");
        expect(result.finishReason).toBe("tool_calls");
        expect(embeddedFinishReason(result)).toBe(result.finishReason);
    });

    /**
     * Regression guard for the exact invariant both the original bug
     * (embedded leaked the raw status) and the follow-up bug (top-level
     * leaked the raw status) violated: the two representations of the same
     * event must never diverge. Unlike the tables above, this doesn't
     * hardcode expected finish_reason values — it directly cross-checks
     * `finishReason === embeddedFinishReason` for every status × tool-call
     * combination, so it stays a meaningful guard even if chatFinishReason's
     * mapping table changes in the future.
     */
    it("top-level finishReason and embedded normalized.choices[0].finish_reason agree for every status, with and without tool calls", () => {
        for (const status of ALL_STATUSES) {
            for (const output of [NO_OUTPUT, TOOL_CALL_OUTPUT]) {
                const result = responsesVariant.parseResponse({ status, output }, ctx);
                expect(result.finishReason).toBe(embeddedFinishReason(result));
            }
        }
    });
});

// ---------------------------------------------------------------------------
// parseStreamChunk
// ---------------------------------------------------------------------------

describe("api-variants/responses — parseStreamChunk: lifecycle & text/reasoning deltas", () => {
    it("captures id/model on response.created", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.created", response: { id: "resp_1", model: "gpt-5" } }, ctx)!;
        expect(delta).toEqual({ content: "", reasoning: "", id: "resp_1", model: "gpt-5" });
    });

    it("captures id/model on response.in_progress", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.in_progress", response: { id: "resp_1", model: "gpt-5" } }, ctx)!;
        expect(delta).toEqual({ content: "", reasoning: "", id: "resp_1", model: "gpt-5" });
    });

    it("handles response.created with no response block", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.created" }, ctx)!;
        expect(delta).toEqual({ content: "", reasoning: "", id: undefined, model: undefined });
    });

    it("emits a text delta on response.output_text.delta", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.output_text.delta", delta: "Hel" }, ctx)!;
        expect(delta).toEqual({ content: "Hel", reasoning: "" });
    });

    it("defaults to an empty text delta when `delta` is missing/non-string", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.output_text.delta" }, ctx)!;
        expect(delta.content).toBe("");
    });

    it.each([
        "response.reasoning_summary_text.delta",
        "response.reasoning_summary.delta",
        "response.reasoning.delta",
    ])("emits a reasoning delta on %s", (type) => {
        const delta = responsesVariant.parseStreamChunk({ type, delta: "thinking…" }, ctx)!;
        expect(delta).toEqual({ content: "", reasoning: "thinking…" });
    });

    it("defaults to an empty reasoning delta when `delta` is missing/non-string", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.reasoning.delta" }, ctx)!;
        expect(delta.reasoning).toBe("");
    });
});

describe("api-variants/responses — parseStreamChunk: tool-call streaming", () => {
    it("emits a function_call shell on response.output_item.added, preferring call_id", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.output_item.added", output_index: 1, item: { type: "function_call", call_id: "call_1", name: "get_weather" } },
            ctx,
        )!;
        expect(delta.toolCalls).toEqual([{ index: 1, id: "call_1", name: "get_weather", argumentsDelta: "" }]);
    });

    it("falls back to `id` when call_id is absent on the shell", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", name: "f" } },
            ctx,
        )!;
        expect(delta.toolCalls).toEqual([{ index: 0, id: "fc_1", name: "f", argumentsDelta: "" }]);
    });

    it("returns null for non-function_call output_item.added events (e.g. message)", () => {
        expect(responsesVariant.parseStreamChunk({ type: "response.output_item.added", output_index: 0, item: { type: "message" } }, ctx)).toBeNull();
    });

    it("returns null when output_index is missing on a function_call shell", () => {
        expect(responsesVariant.parseStreamChunk({ type: "response.output_item.added", item: { type: "function_call", call_id: "c1" } }, ctx)).toBeNull();
    });

    it("emits argumentsDelta on response.function_call_arguments.delta", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.function_call_arguments.delta", output_index: 1, delta: '{"city":' },
            ctx,
        )!;
        expect(delta.toolCalls).toEqual([{ index: 1, argumentsDelta: '{"city":' }]);
    });

    it("returns null when output_index is missing on an arguments delta", () => {
        expect(responsesVariant.parseStreamChunk({ type: "response.function_call_arguments.delta", delta: "x" }, ctx)).toBeNull();
    });

    it("returns null when delta is missing or empty on an arguments delta", () => {
        expect(responsesVariant.parseStreamChunk({ type: "response.function_call_arguments.delta", output_index: 0 }, ctx)).toBeNull();
        expect(responsesVariant.parseStreamChunk({ type: "response.function_call_arguments.delta", output_index: 0, delta: "" }, ctx)).toBeNull();
    });
});

describe("api-variants/responses — parseStreamChunk: terminal events", () => {
    it("response.completed derives finishReason:'stop' with no tool calls, and carries usage", () => {
        const delta = responsesVariant.parseStreamChunk(
            {
                type: "response.completed",
                response: { id: "resp_1", model: "gpt-5", output: [{ type: "message" }], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } },
            },
            ctx,
        )!;
        expect(delta.finishReason).toBe("stop");
        expect(delta.id).toBe("resp_1");
        expect(delta.model).toBe("gpt-5");
        expect(delta.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, input_tokens: 1, output_tokens: 2 });
    });

    it("response.completed derives finishReason:'tool_calls' when output contains a function_call", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.completed", response: { output: [{ type: "function_call", call_id: "c1", name: "f" }] } },
            ctx,
        )!;
        expect(delta.finishReason).toBe("tool_calls");
    });

    it("response.completed with no response block still returns a well-formed delta", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.completed" }, ctx)!;
        expect(delta.finishReason).toBe("stop");
        expect(delta.usage).toBeUndefined();
    });

    it("response.failed sets a terminal error using the upstream message, and forwards id/model", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.failed", response: { id: "resp_1", model: "gpt-5", error: { message: "server exploded" } } },
            ctx,
        )!;
        expect(delta.error).toEqual({ reason: "server exploded" });
        expect(delta.finishReason).toBe("stop");
        expect(delta.id).toBe("resp_1");
        expect(delta.model).toBe("gpt-5");
    });

    it("response.failed defaults to a generic marker when no message is present", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.failed", response: {} }, ctx)!;
        expect(delta.error).toEqual({ reason: "response.failed" });
    });

    it("response.incomplete with reason:max_output_tokens is NOT an error, finishReason:'length'", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } },
            ctx,
        )!;
        expect(delta.error).toBeUndefined();
        expect(delta.finishReason).toBe("length");
    });

    it("response.incomplete with another reason IS an error, finishReason:'length'", () => {
        const delta = responsesVariant.parseStreamChunk(
            { type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } },
            ctx,
        )!;
        expect(delta.error).toEqual({ reason: "incomplete: content_filter" });
        expect(delta.finishReason).toBe("length");
    });

    it("response.incomplete with no reason at all still reports the generic incomplete marker as an error", () => {
        const delta = responsesVariant.parseStreamChunk({ type: "response.incomplete", response: {} }, ctx)!;
        expect(delta.error).toEqual({ reason: "response.incomplete" });
    });
});

describe("api-variants/responses — parseStreamChunk: housekeeping / malformed events", () => {
    it("returns null for events with no `type` at all", () => {
        expect(responsesVariant.parseStreamChunk({}, ctx)).toBeNull();
        expect(responsesVariant.parseStreamChunk(null, ctx)).toBeNull();
    });

    it("returns null for recognized-but-uninteresting housekeeping event types", () => {
        for (const type of ["response.content_part.added", "response.output_item.done", "response.content_part.done", "response.output_text.done"]) {
            expect(responsesVariant.parseStreamChunk({ type }, ctx)).toBeNull();
        }
    });

    it("returns null for a completely unknown event type", () => {
        expect(responsesVariant.parseStreamChunk({ type: "response.some_future_event" }, ctx)).toBeNull();
    });
});
