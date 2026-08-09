// Tests for components/playground/use-playground-chat.ts.
//
// `useChatStream` (from ./chat, another agent's directory) is mocked in
// full — this hook only imports its `useChatStream` VALUE export (the
// rest of the imports from "./chat" are type-only, erased at compile
// time), so a full-replace mock is safe. `extractText`/`hasAttachments`
// (lib/schemas/content) are real, pure helpers — no need to mock them.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushAsync } from "./_render";

const chatStream = vi.hoisted(() => ({ useChatStream: vi.fn() }));
vi.mock("@/components/playground/chat", () => chatStream);

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { usePlaygroundChat } from "@/components/playground/use-playground-chat";
import type { Message } from "@/components/playground/chat";
import type { MessageContent } from "@/lib/schemas/content";

/** A promise + externally-callable resolve/reject, for scripting
 *  "still pending" mid-flight assertions deterministically. */
function createDeferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeChatStreamMock(overrides?: {
    streamMultiple?: ReturnType<typeof vi.fn>;
    retryFailedMessage?: ReturnType<typeof vi.fn>;
    stopAll?: ReturnType<typeof vi.fn>;
}) {
    return {
        streamMultiple: vi.fn().mockResolvedValue(undefined),
        retryFailedMessage: vi.fn().mockResolvedValue(undefined),
        stopAll: vi.fn(),
        ...overrides,
    };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    chatStream.useChatStream.mockReturnValue(makeChatStreamMock());
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------

describe("usePlaygroundChat — initial message normalization", () => {
    it("defaults to an empty array when no initialMessages are given", () => {
        const { result } = renderHook(() => usePlaygroundChat({}));
        expect(result.current.messages).toEqual([]);
    });

    it("fills in missing id (by index), role (defaults 'user'), and content (defaults '') without touching defined fields", () => {
        const raw = [
            { role: "assistant", content: "hi" }, // missing id
            { id: "m2", content: "yo" }, // missing role
            { id: "m3", role: "user" }, // missing content
        ] as unknown as Message[];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: raw }));
        expect(result.current.messages).toEqual([
            { role: "assistant", content: "hi", id: "init-0" },
            { id: "m2", content: "yo", role: "user" },
            { id: "m3", role: "user", content: "" },
        ]);
    });
});

describe("usePlaygroundChat — conversationId switch / isLoading gate", () => {
    it("resets messages to the new initialMessages when conversationId changes", () => {
        const { result, rerender } = renderHook(
            (props: { conversationId: string; initialMessages: Message[] }) => usePlaygroundChat(props),
            { initialProps: { conversationId: "c1", initialMessages: [{ id: "a", role: "user", content: "first" }] } },
        );
        expect(result.current.messages).toEqual([{ id: "a", role: "user", content: "first" }]);

        rerender({ conversationId: "c2", initialMessages: [{ id: "b", role: "user", content: "second" }] });
        expect(result.current.messages).toEqual([{ id: "b", role: "user", content: "second" }]);
    });

    it("does NOT reset messages when conversationId is unchanged, even if initialMessages changes", () => {
        const { result, rerender } = renderHook(
            (props: { conversationId: string; initialMessages: Message[] }) => usePlaygroundChat(props),
            { initialProps: { conversationId: "c1", initialMessages: [{ id: "a", role: "user", content: "first" }] } },
        );
        rerender({ conversationId: "c1", initialMessages: [{ id: "ignored", role: "user", content: "ignored" }] });
        expect(result.current.messages).toEqual([{ id: "a", role: "user", content: "first" }]);
    });

    it("defers the conversationId reset while a submit is in-flight, applying it once isLoading clears", async () => {
        const deferred = createDeferred<void>();
        chatStream.useChatStream.mockReturnValue(makeChatStreamMock({ streamMultiple: vi.fn(() => deferred.promise) }));

        const { result, rerender } = renderHook(
            (props: { conversationId: string; initialMessages: Message[] }) => usePlaygroundChat(props),
            { initialProps: { conversationId: "c1", initialMessages: [] as Message[] } },
        );

        act(() => {
            void result.current.handleSubmit("hello", { models: ["gpt-4o"] });
        });
        expect(result.current.isLoading).toBe(true);
        expect(result.current.messages).toHaveLength(1); // optimistic user message

        // The conversation switches WHILE the submit is still in flight —
        // the effect's `if (isLoading) return` guard must skip the reset.
        rerender({ conversationId: "c2", initialMessages: [{ id: "b", role: "user", content: "second" }] });
        expect(result.current.messages).toHaveLength(1);

        await act(async () => {
            deferred.resolve();
            await flushAsync();
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.messages).toEqual([{ id: "b", role: "user", content: "second" }]);
    });
});

describe("usePlaygroundChat — handleSubmit guards", () => {
    it("no-ops on whitespace-only content with no attachments", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleSubmit("   ", { models: ["gpt-4o"] });
        });
        expect(chat.streamMultiple).not.toHaveBeenCalled();
        expect(result.current.isLoading).toBe(false);
        expect(result.current.messages).toHaveLength(0);
    });

    it("proceeds when there is no text but there IS an attachment", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        const content: MessageContent = [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }];
        await act(async () => {
            await result.current.handleSubmit(content, { models: ["gpt-4o"] });
        });
        expect(chat.streamMultiple).toHaveBeenCalledTimes(1);
    });

    it("shows a toast and skips streaming when no models are selected", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleSubmit("hi", { models: [] });
        });
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Please select a model first");
        expect(chat.streamMultiple).not.toHaveBeenCalled();
        expect(result.current.isLoading).toBe(false);
    });

    it("ignores a second submit while one is already in flight", async () => {
        const deferred = createDeferred<void>();
        const chat = makeChatStreamMock({ streamMultiple: vi.fn(() => deferred.promise) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));

        act(() => {
            void result.current.handleSubmit("first", { models: ["gpt-4o"] });
        });
        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            await result.current.handleSubmit("second", { models: ["gpt-4o"] });
        });
        expect(chat.streamMultiple).toHaveBeenCalledTimes(1);

        await act(async () => {
            deferred.resolve();
            await flushAsync();
        });
    });
});

describe("usePlaygroundChat — handleSubmit happy path", () => {
    it("uses options.contextMessageId as the parent when provided", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleSubmit("hi", { models: ["gpt-4o"], contextMessageId: "ctx-1" });
        });
        expect(chat.streamMultiple).toHaveBeenCalledWith(expect.objectContaining({ parentMessageId: "ctx-1" }));
    });

    it("falls back to the last existing message's id as parent when no contextMessageId is given", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const initial: Message[] = [{ id: "m1", role: "user", content: "prev" }];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: initial }));
        await act(async () => {
            await result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(chat.streamMultiple).toHaveBeenCalledWith(expect.objectContaining({ parentMessageId: "m1" }));
    });

    it("uses an undefined parent when there is no context and no existing messages", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(chat.streamMultiple).toHaveBeenCalledWith(expect.objectContaining({ parentMessageId: undefined }));
    });

    it("forwards userMessageId/userContent/models/config/getModelConfig/enabledMcpServerIds to streamMultiple", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        const getModelConfig = vi.fn();
        await act(async () => {
            await result.current.handleSubmit("hi there", {
                models: ["gpt-4o", "claude-3-opus"],
                config: { temperature: 0.5 },
                getModelConfig,
                enabledMcpServerIds: ["mcp-1"],
            });
        });
        expect(chat.streamMultiple).toHaveBeenCalledWith(
            expect.objectContaining({
                userContent: "hi there",
                models: ["gpt-4o", "claude-3-opus"],
                config: { temperature: 0.5 },
                getModelConfig,
                enabledMcpServerIds: ["mcp-1"],
            }),
        );
        const call = chat.streamMultiple.mock.calls[0][0];
        expect(result.current.messages.at(-1)).toEqual(
            expect.objectContaining({ role: "user", content: "hi there", id: call.userMessageId }),
        );
    });

    it("sets isLoading true immediately, then false once streamMultiple resolves, clearing any prior error", async () => {
        const deferred = createDeferred<void>();
        const chat = makeChatStreamMock({ streamMultiple: vi.fn(() => deferred.promise) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));

        act(() => {
            void result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(result.current.isLoading).toBe(true);
        expect(result.current.error).toBeNull();

        await act(async () => {
            deferred.resolve();
            await flushAsync();
        });
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
    });
});

describe("usePlaygroundChat — handleSubmit error handling", () => {
    it("captures a thrown Error from streamMultiple into error state", async () => {
        const err = new Error("boom");
        const chat = makeChatStreamMock({ streamMultiple: vi.fn().mockRejectedValue(err) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(result.current.error).toBe(err);
        expect(result.current.isLoading).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Chat Error:", err);
    });

    it("wraps a non-Error rejection reason in a new Error", async () => {
        const chat = makeChatStreamMock({ streamMultiple: vi.fn().mockRejectedValue("stringy failure") });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe("stringy failure");
    });
});

describe("usePlaygroundChat — handleRetryFailed", () => {
    const seeded: Message[] = [
        { id: "u1", role: "user", content: "question" },
        { id: "a1", role: "assistant", content: "", model_id: "gpt-4o", parent_id: "u1", error: "network fail" },
        { id: "a2", role: "assistant", content: "ok, no error", model_id: "gpt-4o", parent_id: "u1" },
        { id: "a3", role: "assistant", content: "", model_id: "gpt-4o", parent_id: "missing-user", error: "oops" },
    ];

    it("no-ops while a submit/retry is already in flight", async () => {
        const deferred = createDeferred<void>();
        const chat = makeChatStreamMock({ streamMultiple: vi.fn(() => deferred.promise) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));

        act(() => {
            void result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            await result.current.handleRetryFailed("a1");
        });
        expect(chat.retryFailedMessage).not.toHaveBeenCalled();

        await act(async () => {
            deferred.resolve();
            await flushAsync();
        });
    });

    it("no-ops when the given id doesn't match any message", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));
        await act(async () => {
            await result.current.handleRetryFailed("does-not-exist");
        });
        expect(chat.retryFailedMessage).not.toHaveBeenCalled();
    });

    it("no-ops when the matched message has no .error", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));
        await act(async () => {
            await result.current.handleRetryFailed("a2");
        });
        expect(chat.retryFailedMessage).not.toHaveBeenCalled();
    });

    it("no-ops when the failed message's parent user message can't be found", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));
        await act(async () => {
            await result.current.handleRetryFailed("a3");
        });
        expect(chat.retryFailedMessage).not.toHaveBeenCalled();
    });

    it("happy path: calls retryFailedMessage(failed, userContent, getModelConfig, enabledMcpServerIds)", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));
        const getModelConfig = vi.fn();
        await act(async () => {
            await result.current.handleRetryFailed("a1", { models: ["gpt-4o"], getModelConfig, enabledMcpServerIds: ["mcp-1"] });
        });
        expect(chat.retryFailedMessage).toHaveBeenCalledWith(
            expect.objectContaining({ id: "a1", error: "network fail" }),
            "question",
            getModelConfig,
            ["mcp-1"],
        );
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it("captures errors from retryFailedMessage", async () => {
        const err = new Error("retry boom");
        const chat = makeChatStreamMock({ retryFailedMessage: vi.fn().mockRejectedValue(err) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));
        await act(async () => {
            await result.current.handleRetryFailed("a1");
        });
        expect(result.current.error).toBe(err);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Chat Retry Failed Error:", err);
        expect(result.current.isLoading).toBe(false);
    });

    it("wraps a non-Error rejection reason from retryFailedMessage in a new Error", async () => {
        const chat = makeChatStreamMock({ retryFailedMessage: vi.fn().mockRejectedValue("retry stringy") });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: seeded }));
        await act(async () => {
            await result.current.handleRetryFailed("a1");
        });
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe("retry stringy");
    });
});

describe("usePlaygroundChat — handleRegenerate", () => {
    it("no-ops while already loading", async () => {
        const deferred = createDeferred<void>();
        const chat = makeChatStreamMock({ streamMultiple: vi.fn(() => deferred.promise) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));

        act(() => {
            void result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(result.current.isLoading).toBe(true);
        chat.streamMultiple.mockClear();

        await act(async () => {
            await result.current.handleRegenerate({ models: ["gpt-4o"] });
        });
        expect(chat.streamMultiple).not.toHaveBeenCalled();

        await act(async () => {
            deferred.resolve();
            await flushAsync();
        });
    });

    it("toasts and no-ops when no models are given", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));
        await act(async () => {
            await result.current.handleRegenerate({ models: [] });
        });
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Please select a model first");
        expect(chat.streamMultiple).not.toHaveBeenCalled();
    });

    it("toasts and no-ops when there is no assistant message to regenerate", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const initial: Message[] = [{ id: "u1", role: "user", content: "hi" }];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: initial }));
        await act(async () => {
            await result.current.handleRegenerate({ models: ["gpt-4o"] });
        });
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("No assistant message to regenerate");
        expect(chat.streamMultiple).not.toHaveBeenCalled();
    });

    it("toasts and no-ops when the last assistant message's parent user message can't be found", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const initial: Message[] = [{ id: "a1", role: "assistant", content: "resp", parent_id: "missing" }];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: initial }));
        await act(async () => {
            await result.current.handleRegenerate({ models: ["gpt-4o"] });
        });
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Cannot find parent user message");
        expect(chat.streamMultiple).not.toHaveBeenCalled();
    });

    it("happy path: re-streams from the LAST assistant message's parent (picking the last, not the first)", async () => {
        const chat = makeChatStreamMock();
        chatStream.useChatStream.mockReturnValue(chat);
        const initial: Message[] = [
            { id: "u1", role: "user", content: "the question" },
            { id: "a1", role: "assistant", content: "first answer", parent_id: "u1" },
            { id: "a2", role: "assistant", content: "second answer", parent_id: "u1" },
        ];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: initial }));
        const getModelConfig = vi.fn();
        await act(async () => {
            await result.current.handleRegenerate({ models: ["gpt-4o"], getModelConfig, enabledMcpServerIds: ["mcp-1"] });
        });
        expect(chat.streamMultiple).toHaveBeenCalledWith(
            expect.objectContaining({
                userMessageId: "u1",
                userContent: "the question",
                parentMessageId: undefined,
                models: ["gpt-4o"],
                getModelConfig,
                enabledMcpServerIds: ["mcp-1"],
            }),
        );
    });

    it("captures errors from streamMultiple during regenerate", async () => {
        const err = new Error("regen boom");
        const chat = makeChatStreamMock({ streamMultiple: vi.fn().mockRejectedValue(err) });
        chatStream.useChatStream.mockReturnValue(chat);
        const initial: Message[] = [
            { id: "u1", role: "user", content: "q" },
            { id: "a1", role: "assistant", content: "a", parent_id: "u1" },
        ];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: initial }));
        await act(async () => {
            await result.current.handleRegenerate({ models: ["gpt-4o"] });
        });
        expect(result.current.error).toBe(err);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Chat Regenerate Error:", err);
        expect(result.current.isLoading).toBe(false);
    });

    it("wraps a non-Error rejection reason from streamMultiple during regenerate in a new Error", async () => {
        const chat = makeChatStreamMock({ streamMultiple: vi.fn().mockRejectedValue("regen stringy") });
        chatStream.useChatStream.mockReturnValue(chat);
        const initial: Message[] = [
            { id: "u1", role: "user", content: "q" },
            { id: "a1", role: "assistant", content: "a", parent_id: "u1" },
        ];
        const { result } = renderHook(() => usePlaygroundChat({ initialMessages: initial }));
        await act(async () => {
            await result.current.handleRegenerate({ models: ["gpt-4o"] });
        });
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe("regen stringy");
    });
});

describe("usePlaygroundChat — stop()", () => {
    it("calls stopAll and immediately clears isLoading, even mid-flight", async () => {
        const deferred = createDeferred<void>();
        const chat = makeChatStreamMock({ streamMultiple: vi.fn(() => deferred.promise) });
        chatStream.useChatStream.mockReturnValue(chat);
        const { result } = renderHook(() => usePlaygroundChat({}));

        act(() => {
            void result.current.handleSubmit("hi", { models: ["gpt-4o"] });
        });
        expect(result.current.isLoading).toBe(true);

        act(() => {
            result.current.stop();
        });
        expect(chat.stopAll).toHaveBeenCalledTimes(1);
        expect(result.current.isLoading).toBe(false);

        // The original in-flight submit resolves later; its own `finally`
        // re-sets isLoading(false) again — idempotent, no crash/re-open.
        await act(async () => {
            deferred.resolve();
            await flushAsync();
        });
        expect(result.current.isLoading).toBe(false);
    });
});
