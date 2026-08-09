import { describe, expect, it } from "vitest";
import { chatCompletionsVariant } from "@/lib/server/api-variants/chat-completions";
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

describe("api-variants/chat-completions — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(chatCompletionsVariant.id).toBe("chat.completions");
        expect(chatCompletionsVariant.capability).toBe("chat");
        expect(chatCompletionsVariant.path).toBe("/chat/completions");
        expect(chatCompletionsVariant.supportsStreaming).toBe(true);
        expect(chatCompletionsVariant.transformRequest).toBeUndefined();
    });
});

describe("api-variants/chat-completions — parseResponse", () => {
    it("parses a plain text completion", () => {
        const json = {
            id: "chatcmpl-1",
            model: "gpt-4o-mini",
            choices: [{ message: { content: "Hello there!" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        const result = chatCompletionsVariant.parseResponse(json, ctx);
        expect(result.output).toBe("Hello there!");
        expect(result.promptTokens).toBe(10);
        expect(result.completionTokens).toBe(5);
        expect(result.totalTokens).toBe(15);
        expect(result.finishReason).toBe("stop");
        expect(result.normalized).toBe(json);
        expect(result.toolCalls).toBeUndefined();
        expect(result.error).toBeUndefined();
    });

    it("assembles tool_calls from choices[0].message.tool_calls, filtering out unnamed calls", () => {
        const json = {
            choices: [
                {
                    message: {
                        content: null,
                        tool_calls: [
                            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
                            { id: "call_2", type: "function", function: {} }, // no name -> filtered out
                            { type: "function", function: { name: "no_id_call" } }, // missing id -> defaults to ""
                        ],
                    },
                    finish_reason: "tool_calls",
                },
            ],
        };
        const result = chatCompletionsVariant.parseResponse(json, ctx);
        expect(result.toolCalls).toEqual([
            { id: "call_1", name: "get_weather", arguments: '{"city":"NYC"}' },
            { id: "", name: "no_id_call", arguments: "" },
        ]);
        expect(result.finishReason).toBe("tool_calls");
    });

    it("handles a missing usage block and missing choices gracefully", () => {
        const result = chatCompletionsVariant.parseResponse({}, ctx);
        expect(result.output).toBeNull();
        expect(result.promptTokens).toBeNull();
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
        expect(result.finishReason).toBeUndefined();
        expect(result.toolCalls).toBeUndefined();
    });

    it("handles a null/undefined json body without throwing", () => {
        const nullResult = chatCompletionsVariant.parseResponse(null, ctx);
        expect(nullResult.output).toBeNull();
        expect(nullResult.promptTokens).toBeNull();
        expect(nullResult.totalTokens).toBeNull();

        const undefResult = chatCompletionsVariant.parseResponse(undefined, ctx);
        expect(undefResult.output).toBeNull();
        expect(undefResult.promptTokens).toBeNull();
    });

    it("surfaces a 200-with-error envelope as `error`", () => {
        const json = { error: { message: "context length exceeded" } };
        const result = chatCompletionsVariant.parseResponse(json, ctx);
        expect(result.error).toBe("context length exceeded");
    });
});

describe("api-variants/chat-completions — parseStreamChunk", () => {
    it("parses a plain content delta", () => {
        const delta = chatCompletionsVariant.parseStreamChunk(
            { id: "chatcmpl-1", model: "gpt-4o-mini", choices: [{ delta: { content: "Hi" } }] },
            ctx,
        )!;
        expect(delta.content).toBe("Hi");
        expect(delta.reasoning).toBe("");
        expect(delta.id).toBe("chatcmpl-1");
        expect(delta.model).toBe("gpt-4o-mini");
        expect(delta.toolCalls).toBeUndefined();
        expect(delta.finishReason).toBeUndefined();
        expect(delta.error).toBeUndefined();
    });

    it("parses a reasoning_content delta", () => {
        const delta = chatCompletionsVariant.parseStreamChunk({ choices: [{ delta: { reasoning_content: "thinking…" } }] }, ctx)!;
        expect(delta.content).toBe("");
        expect(delta.reasoning).toBe("thinking…");
    });

    it("parses tool-call deltas with index/id/name/argumentsDelta", () => {
        const delta = chatCompletionsVariant.parseStreamChunk(
            {
                choices: [
                    {
                        delta: {
                            tool_calls: [
                                { index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"ci' } },
                            ],
                        },
                    },
                ],
            },
            ctx,
        )!;
        expect(delta.toolCalls).toEqual([{ index: 0, id: "call_1", name: "get_weather", argumentsDelta: '{"ci' }]);
    });

    it("parses a subsequent tool-call argument-only delta (no id/name repeated)", () => {
        const delta = chatCompletionsVariant.parseStreamChunk(
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"NYC"}' } }] } }] },
            ctx,
        )!;
        expect(delta.toolCalls).toEqual([{ index: 0, id: undefined, name: undefined, argumentsDelta: 'ty":"NYC"}' }]);
    });

    it("defaults tool_calls[].index to 0 when the upstream omits it", () => {
        const delta = chatCompletionsVariant.parseStreamChunk(
            { choices: [{ delta: { tool_calls: [{ function: { name: "f" } }] } }] },
            ctx,
        )!;
        expect(delta.toolCalls).toEqual([{ index: 0, id: undefined, name: "f", argumentsDelta: undefined }]);
    });

    it("captures finish_reason and system_fingerprint on the terminal chunk", () => {
        const delta = chatCompletionsVariant.parseStreamChunk(
            { choices: [{ delta: {}, finish_reason: "stop" }], system_fingerprint: "fp_123" },
            ctx,
        )!;
        expect(delta.finishReason).toBe("stop");
        expect(delta.systemFingerprint).toBe("fp_123");
    });

    it("captures usage on a usage-only final chunk with empty choices", () => {
        const delta = chatCompletionsVariant.parseStreamChunk(
            { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
            ctx,
        )!;
        expect(delta.content).toBe("");
        expect(delta.reasoning).toBe("");
        expect(delta.usage).toEqual({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
        expect(delta.finishReason).toBeUndefined();
    });

    it("returns non-null with empty content/reasoning when choices is entirely absent", () => {
        const delta = chatCompletionsVariant.parseStreamChunk({}, ctx)!;
        expect(delta).not.toBeNull();
        expect(delta.content).toBe("");
        expect(delta.reasoning).toBe("");
        expect(delta.toolCalls).toBeUndefined();
    });

    it("surfaces a mid-stream {error} envelope as a terminal-error delta", () => {
        const delta = chatCompletionsVariant.parseStreamChunk({ error: { message: "rate limited" } }, ctx)!;
        expect(delta.error).toEqual({ reason: "rate limited" });
    });

    it("has no error when the chunk is a normal delta", () => {
        const delta = chatCompletionsVariant.parseStreamChunk({ choices: [{ delta: { content: "hi" } }] }, ctx)!;
        expect(delta.error).toBeUndefined();
    });
});
