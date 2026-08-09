import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThrottledUpdater } from "@/components/playground/chat/throttled-updater";
import type { Message } from "@/components/playground/chat/types";

function baseMessages(id = "client_1"): Message[] {
    return [{ id, role: "assistant", content: "" }];
}

/** Invokes the latest `setMessages` functional update against `prev`
 *  and returns the resulting array — mirrors what React would do. */
function applyLatestUpdate(setMessages: ReturnType<typeof vi.fn>, prev: Message[]): Message[] {
    const updater = setMessages.mock.calls.at(-1)![0] as (p: Message[]) => Message[];
    return updater(prev);
}

describe("ThrottledUpdater", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        return () => vi.useRealTimers();
    });

    describe("throttled scheduling", () => {
        it("does not call setMessages synchronously — the first update is deferred to the next frame", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.appendContent("Hello", "");
            expect(setMessages).not.toHaveBeenCalled();

            vi.advanceTimersToNextFrame();
            expect(setMessages).toHaveBeenCalledTimes(1);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].content).toBe("Hello");
            expect(result[0].reasoning_content).toBeUndefined();
        });

        it("coalesces multiple appendContent calls made before the frame fires into a single update", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.appendContent("A", "");
            updater.appendContent("B", "");
            updater.appendContent("C", "");
            vi.advanceTimersToNextFrame();

            expect(setMessages).toHaveBeenCalledTimes(1);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].content).toBe("ABC");
        });

        it("throttles a second burst within minInterval via a setTimeout+rAF chain", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.appendContent("Hello", "");
            vi.advanceTimersToNextFrame(); // first update flushes immediately
            expect(setMessages).toHaveBeenCalledTimes(1);

            updater.appendContent(" world", "");
            // Still within the 100ms throttle window — no update yet.
            expect(setMessages).toHaveBeenCalledTimes(1);

            vi.advanceTimersToNextTimer(); // fires the throttle setTimeout, which schedules a rAF
            expect(setMessages).toHaveBeenCalledTimes(1);

            vi.advanceTimersToNextFrame(); // fires that rAF
            expect(setMessages).toHaveBeenCalledTimes(2);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].content).toBe("Hello world");
        });

        it("schedules a fresh update immediately once minInterval has elapsed", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.appendContent("Hello", "");
            vi.advanceTimersToNextFrame();
            expect(setMessages).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(150); // let the throttle window fully elapse
            updater.appendContent(" world", "");
            // Enough time has passed — this goes straight to rAF, no setTimeout hop.
            vi.advanceTimersToNextFrame();
            expect(setMessages).toHaveBeenCalledTimes(2);
        });

        it("matches messages by clientMessageId or the server-assigned id (upsert-by-either-id)", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.setServerIds("server_1", "gen_1");

            updater.appendContent("hi", "");
            vi.advanceTimersToNextFrame();

            const byClientId = applyLatestUpdate(setMessages, [{ id: "client_1", role: "assistant", content: "" }]);
            expect(byClientId[0].content).toBe("hi");

            const byServerId = applyLatestUpdate(setMessages, [{ id: "server_1", role: "assistant", content: "" }]);
            expect(byServerId[0].content).toBe("hi");

            const noMatch = applyLatestUpdate(setMessages, [{ id: "unrelated", role: "assistant", content: "" }]);
            expect(noMatch[0].content).toBe("");
        });
    });

    describe("flush()", () => {
        it("bypasses the throttle window and updates synchronously", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.appendContent("Hello", "");
            vi.advanceTimersToNextFrame();
            updater.appendContent(" world", ""); // schedules a throttled setTimeout

            updater.flush(true);
            expect(setMessages).toHaveBeenCalledTimes(2);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].content).toBe("Hello world");
        });

        it("cancels the pending throttled timer so it does not double-fire later", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("Hello", "");
            vi.advanceTimersToNextFrame();
            updater.appendContent(" world", "");

            updater.flush(true);
            expect(setMessages).toHaveBeenCalledTimes(2);

            // Draining every remaining fake timer must not produce a 3rd call.
            vi.runAllTimers();
            expect(setMessages).toHaveBeenCalledTimes(2);
        });

        it("omits reasoning_content when no reasoning has accumulated", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("Hello", "");
            updater.flush(true);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].reasoning_content).toBeUndefined();
            expect(result[0].content).toBe("Hello");
        });

        it("includes reasoning_content once reasoning has accumulated", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("Hello", "thinking");
            updater.flush(true);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].reasoning_content).toBe("thinking");
        });
    });

    describe("server ids & includeIds", () => {
        it("leaves the message's own id untouched (and no generation_id) when no server ids were ever set", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("hi", "");
            updater.flush(true);
            const result = applyLatestUpdate(setMessages, baseMessages());
            // `update.id` is absent, so the spread `{...m, ...update}` leaves
            // the placeholder's own client-side id unchanged rather than
            // clearing it.
            expect(result[0].id).toBe("client_1");
            expect(result[0].generation_id).toBeUndefined();
        });

        it("includes id/generation_id on flush(true) once server ids are set", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.setServerIds("srv_42", "gen_42");
            expect(updater.getServerMessageId()).toBe("srv_42");
            expect(updater.getServerGenerationId()).toBe("gen_42");

            updater.appendContent("hi", "");
            updater.flush(true);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].id).toBe("srv_42");
            expect(result[0].generation_id).toBe("gen_42");
        });

        it("never includes ids on a throttle-driven (rAF) update, even when server ids are set", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.setServerIds("srv_1", "gen_1");

            updater.appendContent("hi", "");
            vi.advanceTimersToNextFrame(); // natural throttled path always calls doUpdate(false)

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].id).toBe("client_1"); // unchanged — no id/generation_id in this update
            expect(result[0].generation_id).toBeUndefined();
        });

        it("flush(false) omits ids even when server ids are set", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.setServerIds("srv_1", "gen_1");
            updater.appendContent("hi", "");
            updater.flush(false);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].id).toBe("client_1");
            expect(result[0].generation_id).toBeUndefined();
        });
    });

    describe("tool call assembly", () => {
        it("merges progressive argument deltas for the same index into one assembled call", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.applyToolCallDelta({ index: 0, id: "call_1", name: "search" });
            updater.applyToolCallDelta({ index: 0, argumentsDelta: '{"q":' });
            updater.applyToolCallDelta({ index: 0, argumentsDelta: '"x"}' });
            updater.flush(true);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls).toEqual([
                { id: "call_1", name: "search", arguments: '{"q":"x"}' },
            ]);
        });

        it("sorts assembled calls by index regardless of arrival order", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);

            updater.applyToolCallDelta({ index: 1, id: "call_b", name: "second" });
            updater.applyToolCallDelta({ index: 0, id: "call_a", name: "first" });
            updater.flush(true);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls?.map((c) => c.id)).toEqual(["call_a", "call_b"]);
        });

        it("omits tool_calls entirely when no tool-call deltas have arrived", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("just text", "");
            updater.flush(true);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls).toBeUndefined();
        });

        it("does not rebuild tool_calls on a later flush once the dirty flag has been cleared", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.applyToolCallDelta({ index: 0, id: "call_1", name: "search" });
            updater.flush(true); // clears the toolCallsDirty flag
            let result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls).toEqual([{ id: "call_1", name: "search", arguments: "" }]);

            updater.appendContent("more text, no new tool calls", "");
            updater.flush(true);
            result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls).toBeUndefined();
        });
    });

    describe("applyToolResult", () => {
        it("attaches a result to a call assembled from a prior delta", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.applyToolCallDelta({ index: 0, id: "call_1", name: "search" });
            updater.applyToolResult({ call_id: "call_1", name: "search", content: "3 results", is_error: false });
            updater.flush(true);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls).toEqual([
                {
                    id: "call_1",
                    name: "search",
                    arguments: "",
                    source: undefined,
                    result: { content: "3 results", is_error: false, source: undefined },
                },
            ]);
        });

        it("synthesizes a new slot when a result arrives for a call_id with no prior delta", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.applyToolResult({
                call_id: "orphan_call",
                name: "unseen_tool",
                content: "done",
                is_error: false,
                source: "github",
            });
            updater.flush(true);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls).toEqual([
                {
                    id: "orphan_call",
                    name: "unseen_tool",
                    arguments: "",
                    source: "github",
                    result: { content: "done", is_error: false, source: "github" },
                },
            ]);
        });

        it("synthesizes the orphan slot at the next available index, after any known calls", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.applyToolCallDelta({ index: 0, id: "call_1", name: "first" });
            updater.applyToolResult({ call_id: "orphan", name: "second", content: "ok", is_error: false });
            updater.flush(true);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls?.map((c) => c.id)).toEqual(["call_1", "orphan"]);
        });

        it("marks is_error true and preserves source on error results", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.applyToolCallDelta({ index: 0, id: "call_1", name: "search" });
            updater.applyToolResult({
                call_id: "call_1",
                name: "search",
                content: "boom",
                is_error: true,
                source: "github",
            });
            updater.flush(true);

            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].tool_calls?.[0].result).toEqual({ content: "boom", is_error: true, source: "github" });
            expect(result[0].tool_calls?.[0].source).toBe("github");
        });
    });

    describe("getContent()", () => {
        it("returns the raw accumulated content/reasoning without needing a flush", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("partial", "reasoning bit");
            expect(updater.getContent()).toEqual({ content: "partial", reasoning: "reasoning bit" });
        });
    });

    describe("dispose()", () => {
        it("cancels a pending rAF-scheduled update so it never fires", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("hello", "");
            updater.dispose();

            vi.runAllTimers();
            expect(setMessages).not.toHaveBeenCalled();
        });

        it("cancels a pending setTimeout-scheduled throttle chain so it never fires", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("hello", "");
            vi.advanceTimersToNextFrame(); // first update flushes, arms the throttle window
            expect(setMessages).toHaveBeenCalledTimes(1);

            updater.appendContent(" world", ""); // schedules the setTimeout+rAF throttle chain
            updater.dispose();

            vi.runAllTimers();
            expect(setMessages).toHaveBeenCalledTimes(1);
        });

        it("does not prevent a subsequent appendContent from scheduling a fresh update", () => {
            const setMessages = vi.fn();
            const updater = new ThrottledUpdater("client_1", setMessages, 100);
            updater.appendContent("hello", "");
            updater.dispose();

            updater.appendContent("again", "");
            vi.advanceTimersToNextFrame();
            expect(setMessages).toHaveBeenCalledTimes(1);
            const result = applyLatestUpdate(setMessages, baseMessages());
            expect(result[0].content).toBe("helloagain");
        });
    });
});
