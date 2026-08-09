import { describe, expect, it } from "vitest";

// Import via the barrel to exercise components/playground/chat/index.ts's
// re-export statements too (barrel isn't excluded from coverage).
import { SSEParser } from "@/components/playground/chat";
import type { ParsedEvent } from "@/components/playground/chat/stream-parser";

/** Builds a well-formed `data: {...}\n\n` SSE record for a chat-completion chunk. */
function chunkRecord(delta: Record<string, unknown>): string {
    return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

describe("SSEParser", () => {
    describe("content events", () => {
        it("emits a content event for a plain text delta", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ content: "Hello" }));
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "Hello", reasoning: "" }]);
        });

        it("emits content + reasoning together", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ content: "Hi", reasoning_content: "thinking..." }));
            expect(events).toEqual<ParsedEvent[]>([
                { type: "content", content: "Hi", reasoning: "thinking..." },
            ]);
        });

        it("emits a content event carrying only reasoning when content is absent", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ reasoning_content: "step one" }));
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "", reasoning: "step one" }]);
        });

        it("does not emit anything when both content and reasoning are empty", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({}));
            expect(events).toEqual([]);
        });

        it("does not emit anything and does not throw when choices is missing entirely", () => {
            const parser = new SSEParser();
            const events = parser.parse(`data: ${JSON.stringify({})}\n\n`);
            expect(events).toEqual([]);
        });

        it("treats an explicit empty string content as falsy (no event)", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ content: "" }));
            expect(events).toEqual([]);
        });
    });

    describe("tool_call_delta events", () => {
        it("emits one tool_call_delta per array entry, with id/name/argumentsDelta", () => {
            const parser = new SSEParser();
            const events = parser.parse(
                chunkRecord({
                    tool_calls: [
                        { index: 0, id: "call_1", function: { name: "search", arguments: '{"q":' } },
                        { index: 1, function: { arguments: '"x"}' } },
                    ],
                })
            );
            expect(events).toEqual<ParsedEvent[]>([
                {
                    type: "tool_call_delta",
                    call: { index: 0, id: "call_1", name: "search", argumentsDelta: '{"q":' },
                },
                {
                    type: "tool_call_delta",
                    call: { index: 1, id: undefined, name: undefined, argumentsDelta: '"x"}' },
                },
            ]);
        });

        it("defaults index to 0 when tc.index is not a number", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ tool_calls: [{ function: { name: "foo" } }] }));
            expect(events).toEqual<ParsedEvent[]>([
                { type: "tool_call_delta", call: { index: 0, id: undefined, name: "foo", argumentsDelta: undefined } },
            ]);
        });

        it("ignores tool_calls when it is not an array", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ tool_calls: "not-an-array" }));
            expect(events).toEqual([]);
        });

        it("emits both a content event and tool_call_delta events from the same chunk", () => {
            const parser = new SSEParser();
            const events = parser.parse(
                chunkRecord({ content: "Let me check", tool_calls: [{ index: 0, id: "c1" }] })
            );
            expect(events).toEqual<ParsedEvent[]>([
                { type: "content", content: "Let me check", reasoning: "" },
                { type: "tool_call_delta", call: { index: 0, id: "c1", name: undefined, argumentsDelta: undefined } },
            ]);
        });
    });

    describe("[DONE] sentinel", () => {
        it("emits a done event for data: [DONE]", () => {
            const parser = new SSEParser();
            expect(parser.parse("data: [DONE]\n\n")).toEqual<ParsedEvent[]>([{ type: "done" }]);
        });

        it("emits a done event for the no-space data:[DONE] form", () => {
            const parser = new SSEParser();
            expect(parser.parse("data:[DONE]\n\n")).toEqual<ParsedEvent[]>([{ type: "done" }]);
        });
    });

    describe("malformed JSON on the default path", () => {
        it("silently swallows unparseable data without throwing or emitting", () => {
            const parser = new SSEParser();
            expect(() => {
                const events = parser.parse("data: {not-json\n\n");
                expect(events).toEqual([]);
            }).not.toThrow();
        });
    });

    describe("synthetic loom_message_meta events", () => {
        it("parses message_id + generation_id", () => {
            const parser = new SSEParser();
            const events = parser.parse(
                `event: loom_message_meta\ndata: ${JSON.stringify({
                    message_id: "msg_1",
                    generation_id: "gen_1",
                })}\n\n`
            );
            expect(events).toEqual<ParsedEvent[]>([
                { type: "message_meta", messageId: "msg_1", generationId: "gen_1" },
            ]);
        });

        it("leaves messageId/generationId undefined when fields are missing or the wrong type", () => {
            const parser = new SSEParser();
            const events = parser.parse(
                `event: loom_message_meta\ndata: ${JSON.stringify({ message_id: 42 })}\n\n`
            );
            expect(events).toEqual<ParsedEvent[]>([
                { type: "message_meta", messageId: undefined, generationId: undefined },
            ]);
        });

        it("silently ignores malformed JSON (no event emitted at all)", () => {
            const parser = new SSEParser();
            const events = parser.parse("event: loom_message_meta\ndata: {broken\n\n");
            expect(events).toEqual([]);
        });
    });

    describe("synthetic loom_tool_result events", () => {
        it("parses a full tool result", () => {
            const parser = new SSEParser();
            const events = parser.parse(
                `event: loom_tool_result\ndata: ${JSON.stringify({
                    call_id: "call_1",
                    name: "search_repositories",
                    content: "found 3 repos",
                    is_error: false,
                    source: "github",
                })}\n\n`
            );
            expect(events).toEqual<ParsedEvent[]>([
                {
                    type: "tool_result",
                    result: {
                        call_id: "call_1",
                        name: "search_repositories",
                        content: "found 3 repos",
                        is_error: false,
                        source: "github",
                    },
                },
            ]);
        });

        it("coerces missing fields to string defaults and is_error to boolean", () => {
            const parser = new SSEParser();
            const events = parser.parse(`event: loom_tool_result\ndata: ${JSON.stringify({ is_error: 1 })}\n\n`);
            expect(events).toEqual<ParsedEvent[]>([
                {
                    type: "tool_result",
                    result: { call_id: "", name: "", content: "", is_error: true, source: undefined },
                },
            ]);
        });

        it("silently ignores malformed JSON", () => {
            const parser = new SSEParser();
            const events = parser.parse("event: loom_tool_result\ndata: {broken\n\n");
            expect(events).toEqual([]);
        });
    });

    describe("synthetic loom_tool_error events", () => {
        it("parses message + serverName", () => {
            const parser = new SSEParser();
            const events = parser.parse(
                `event: loom_tool_error\ndata: ${JSON.stringify({
                    message: "timed out",
                    server_name: "github",
                })}\n\n`
            );
            expect(events).toEqual<ParsedEvent[]>([
                { type: "tool_error", message: "timed out", serverName: "github" },
            ]);
        });

        it("falls back to a default message when missing", () => {
            const parser = new SSEParser();
            const events = parser.parse(`event: loom_tool_error\ndata: ${JSON.stringify({})}\n\n`);
            expect(events).toEqual<ParsedEvent[]>([{ type: "tool_error", message: "Tool error", serverName: undefined }]);
        });

        it("silently ignores malformed JSON", () => {
            const parser = new SSEParser();
            const events = parser.parse("event: loom_tool_error\ndata: {broken\n\n");
            expect(events).toEqual([]);
        });
    });

    describe("error events (both 'loom_error' and 'error' event names)", () => {
        it.each(["loom_error", "error"])("parses data.error.message for event '%s'", (eventName) => {
            const parser = new SSEParser();
            const events = parser.parse(
                `event: ${eventName}\ndata: ${JSON.stringify({ error: { message: "rate limited" } })}\n\n`
            );
            expect(events).toEqual<ParsedEvent[]>([{ type: "error", message: "rate limited" }]);
        });

        it("falls back to data.message when data.error.message is absent", () => {
            const parser = new SSEParser();
            const events = parser.parse(`event: error\ndata: ${JSON.stringify({ message: "plain message" })}\n\n`);
            expect(events).toEqual<ParsedEvent[]>([{ type: "error", message: "plain message" }]);
        });

        it("falls back to 'Streaming error' when neither is present", () => {
            const parser = new SSEParser();
            const events = parser.parse(`event: error\ndata: ${JSON.stringify({})}\n\n`);
            expect(events).toEqual<ParsedEvent[]>([{ type: "error", message: "Streaming error" }]);
        });

        it("still emits an error event (with the fallback message) when the JSON is malformed", () => {
            // Unlike the other synthetic events, the `error` catch block
            // pushes a fallback event instead of silently dropping it.
            const parser = new SSEParser();
            const events = parser.parse("event: error\ndata: {broken\n\n");
            expect(events).toEqual<ParsedEvent[]>([{ type: "error", message: "Streaming error" }]);
        });
    });

    describe("SSE framing", () => {
        it("resets currentEvent on a blank line so a later plain data line isn't misattributed", () => {
            const parser = new SSEParser();
            // `loom_tool_result` event-type line, followed by a blank-line
            // terminator with NO data — the accumulator must reset so the
            // *next* record (a plain chat-completion chunk) is parsed as
            // 'content', not swallowed as a stray tool_result.
            const events = parser.parse(
                `event: loom_tool_result\n\n${chunkRecord({ content: "hello" })}`
            );
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "hello", reasoning: "" }]);
        });

        it("resets currentEvent on a whitespace-only line", () => {
            const parser = new SSEParser();
            const events = parser.parse(`event: loom_tool_result\n   \n${chunkRecord({ content: "hi" })}`);
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "hi", reasoning: "" }]);
        });

        it("skips lines that are neither event: nor data:", () => {
            const parser = new SSEParser();
            const events = parser.parse(`: this is an SSE comment\nid: 123\n${chunkRecord({ content: "ok" })}`);
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "ok", reasoning: "" }]);
        });

        it("parses multiple records delivered in a single chunk", () => {
            const parser = new SSEParser();
            const events = parser.parse(chunkRecord({ content: "one" }) + chunkRecord({ content: "two" }));
            expect(events).toEqual<ParsedEvent[]>([
                { type: "content", content: "one", reasoning: "" },
                { type: "content", content: "two", reasoning: "" },
            ]);
        });

        it("accepts the no-space 'data:' prefix form", () => {
            const parser = new SSEParser();
            const events = parser.parse(`data:${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}\n\n`);
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "x", reasoning: "" }]);
        });

        it("buffers a partial line across chunk boundaries and parses once complete", () => {
            const parser = new SSEParser();
            const full = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
            const splitAt = Math.floor(full.length / 2);
            const chunk1 = `data: ${full.slice(0, splitAt)}`;
            const chunk2 = `${full.slice(splitAt)}\n\n`;

            const first = parser.parse(chunk1);
            expect(first).toEqual([]); // held in buffer — no trailing newline yet

            const second = parser.parse(chunk2);
            expect(second).toEqual<ParsedEvent[]>([{ type: "content", content: "hi", reasoning: "" }]);
        });

        it("buffers a partial line split mid multi-byte-looking boundary across 3 chunks", () => {
            const parser = new SSEParser();
            const full = `data: ${JSON.stringify({ choices: [{ delta: { content: "abc" } }] })}\n\n`;
            const a = full.slice(0, 5);
            const b = full.slice(5, 15);
            const c = full.slice(15);

            expect(parser.parse(a)).toEqual([]);
            expect(parser.parse(b)).toEqual([]);
            expect(parser.parse(c)).toEqual<ParsedEvent[]>([{ type: "content", content: "abc", reasoning: "" }]);
        });
    });

    describe("reset()", () => {
        it("clears a pending event-type accumulator", () => {
            const parser = new SSEParser();
            // Set currentEvent without terminating the record (no blank line, no data yet).
            parser.parse("event: loom_tool_result\n");
            parser.reset();

            const events = parser.parse(chunkRecord({ content: "after reset" }));
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "after reset", reasoning: "" }]);
        });

        it("clears the carried-over partial-line buffer", () => {
            const parser = new SSEParser();
            // Leave a dangling partial line (no trailing newline) in the buffer.
            parser.parse("data: {\"incomplete");
            parser.reset();

            // A fresh, complete record parsed after reset must stand on its
            // own — it must NOT be fused with the stale partial buffer text.
            const events = parser.parse(chunkRecord({ content: "clean" }));
            expect(events).toEqual<ParsedEvent[]>([{ type: "content", content: "clean", reasoning: "" }]);
        });
    });
});
