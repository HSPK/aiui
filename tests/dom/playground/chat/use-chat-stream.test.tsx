import * as React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/components/playground/chat/types";

// `useChatStream` orchestrates via a real `StreamClient` + `ThrottledUpdater`
// pair. `ThrottledUpdater` is unit-tested exhaustively elsewhere and is safe
// to use for real here (flush() is synchronous, no fake timers needed).
// `StreamClient` is mocked so each test can script exactly which callbacks
// fire, in which order, for which model — without touching fetch/SSE.
const { streamClientInstances, StreamClientMock, behaviorByModel } = vi.hoisted(() => {
    type Behavior = (config: any, callbacks: any) => void | Promise<void>;
    const streamClientInstances: Array<{ stream: any; abort: any; getController: any }> = [];
    const behaviorByModel: Record<string, Behavior> = {};
    // NB: must be a `function` (not an arrow function) — `use-chat-stream.ts`
    // calls `new StreamClient()`, and arrow functions can't be constructors.
    const StreamClientMock = vi.fn().mockImplementation(function StreamClient() {
        const instance = {
            abort: vi.fn(),
            getController: vi.fn(() => null),
            stream: vi.fn(async (config: any, callbacks: any) => {
                const behavior = behaviorByModel[config.model];
                if (behavior) await behavior(config, callbacks);
            }),
        };
        streamClientInstances.push(instance);
        return instance;
    });
    return { streamClientInstances, StreamClientMock, behaviorByModel };
});

vi.mock("@/components/playground/chat/stream-client", () => ({ StreamClient: StreamClientMock }));

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

 
import { useChatStream } from "@/components/playground/chat/use-chat-stream";

function useHarness(conversationId: string | undefined, updateInterval = 100) {
    const [messages, setMessages] = React.useState<Message[]>([]);
    const chat = useChatStream(conversationId, setMessages, updateInterval);
    return { messages, setMessages, ...chat };
}

function abortError() {
    return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

beforeEach(() => {
    streamClientInstances.length = 0;
    StreamClientMock.mockClear();
    toastMock.error.mockClear();
    toastMock.success.mockClear();
    for (const key of Object.keys(behaviorByModel)) delete behaviorByModel[key];
});

describe("useChatStream", () => {
    describe("streamMultiple — placeholder creation & request wiring", () => {
        it("creates one assistant placeholder per model immediately, in request order", async () => {
            const { result } = renderHook(() => useHarness("conv_1"));

            let pending!: Promise<void>;
            act(() => {
                pending = result.current.streamMultiple({
                    userMessageId: "user_1",
                    userContent: "Hi",
                    models: ["gpt-4o", "claude-3"],
                });
            });

            expect(result.current.messages).toHaveLength(2);
            expect(result.current.messages[0]).toMatchObject({
                role: "assistant",
                content: "",
                model_id: "gpt-4o",
                parent_id: "user_1",
            });
            expect(result.current.messages[1]).toMatchObject({
                role: "assistant",
                content: "",
                model_id: "claude-3",
                parent_id: "user_1",
            });
            // Placeholder ids must be distinct (crypto.randomUUID per model).
            expect(result.current.messages[0].id).not.toBe(result.current.messages[1].id);

            // Let the (unconfigured, immediately-resolving) mocked streams settle
            // inside act() so their trailing flush()-driven setState is captured.
            await act(async () => {
                await pending;
            });
        });

        it("forwards conversationId, parentMessageId, enabledMcpServerIds and per-model config", async () => {
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({
                    userMessageId: "u1",
                    userContent: "hi",
                    parentMessageId: "parent_1",
                    models: ["gpt-4o", "claude-3"],
                    getModelConfig: (modelId) => (modelId === "gpt-4o" ? { temperature: 0.2 } : { temperature: 0.9 }),
                    enabledMcpServerIds: ["github"],
                });
            });

            expect(streamClientInstances).toHaveLength(2);
            const configA = streamClientInstances[0].stream.mock.calls[0][0];
            const configB = streamClientInstances[1].stream.mock.calls[0][0];
            expect(configA).toMatchObject({
                conversationId: "conv_1",
                model: "gpt-4o",
                content: "hi",
                userMessageId: "u1",
                parentMessageId: "parent_1",
                enabledMcpServerIds: ["github"],
                additionalConfig: { temperature: 0.2 },
            });
            expect(configA.assistantMessageId).toBe(result.current.messages[0].id);
            expect(configB).toMatchObject({ model: "claude-3", additionalConfig: { temperature: 0.9 } });
        });

        it("uses the flat `config` prop for every model when getModelConfig is not provided", async () => {
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({
                    userMessageId: "u1",
                    userContent: "hi",
                    models: ["a", "b"],
                    config: { temperature: 0.3 },
                });
            });

            expect(streamClientInstances[0].stream.mock.calls[0][0].additionalConfig).toEqual({ temperature: 0.3 });
            expect(streamClientInstances[1].stream.mock.calls[0][0].additionalConfig).toEqual({ temperature: 0.3 });
        });
    });

    describe("streaming callbacks feed the ThrottledUpdater", () => {
        it("reflects the final accumulated content after content deltas + flush", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onContent("Hello", "");
                callbacks.onContent(" world", "");
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(result.current.messages[0].content).toBe("Hello world");
        });

        it("assembles tool_call_delta + tool_result into the final message's tool_calls", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onToolEvent({
                    type: "tool_call_delta",
                    call: { index: 0, id: "call_1", name: "search", argumentsDelta: '{"q":"x"}' },
                });
                callbacks.onToolEvent({
                    type: "tool_result",
                    result: { call_id: "call_1", name: "search", content: "done", is_error: false },
                });
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(result.current.messages[0].tool_calls).toEqual([
                {
                    id: "call_1",
                    name: "search",
                    arguments: '{"q":"x"}',
                    source: undefined,
                    result: { content: "done", is_error: false, source: undefined },
                },
            ]);
        });

        it("shows an MCP error toast with the server name when tool_error includes one", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onToolEvent({ type: "tool_error", message: "boom", serverName: "github" });
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(toastMock.error).toHaveBeenCalledWith("MCP (github): boom");
        });

        it("omits the parens in the toast when tool_error has no serverName", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onToolEvent({ type: "tool_error", message: "boom" });
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(toastMock.error).toHaveBeenCalledWith("MCP: boom");
        });

        it("adopts the server-assigned id/generation_id once onComplete fires", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onContent("hi", "");
                callbacks.onComplete("srv_1", "gen_1");
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(result.current.messages[0].id).toBe("srv_1");
            expect(result.current.messages[0].generation_id).toBe("gen_1");
        });
    });

    describe("error handling", () => {
        it("sets .error on the message when the stream throws a non-abort error, and logs it", async () => {
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onError(new Error("upstream boom"));
                throw new Error("upstream boom");
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(result.current.messages[0].error).toBe("upstream boom");
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });

        it("matches the error update by the resolved server id when onComplete fired before the failure", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onComplete("srv_9", "gen_9");
                throw new Error("late failure");
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(result.current.messages[0].id).toBe("srv_9");
            expect(result.current.messages[0].generation_id).toBe("gen_9");
            expect(result.current.messages[0].error).toBe("late failure");
        });

        it("treats an AbortError as a clean stop: flushes accumulated content, sets no .error", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onContent("partial", "");
                throw abortError();
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["gpt-4o"] });
            });

            expect(result.current.messages[0].content).toBe("partial");
            expect(result.current.messages[0].error).toBeUndefined();
        });

        it("resolves streamMultiple after all models settle even when one fails (Promise.allSettled)", async () => {
            behaviorByModel.good = (_config, callbacks) => {
                callbacks.onContent("ok", "");
            };
            behaviorByModel.bad = () => {
                throw new Error("bad model failure");
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["good", "bad"] });
            });

            expect(result.current.messages[0].content).toBe("ok");
            expect(result.current.messages[0].error).toBeUndefined();
            expect(result.current.messages[1].error).toBe("bad model failure");
        });
    });

    describe("stopAll()", () => {
        it("aborts every in-flight client and lets AbortError settle each task cleanly", async () => {
            let rejectA!: (err: unknown) => void;
            let rejectB!: (err: unknown) => void;
            behaviorByModel.a = () => new Promise<void>((_resolve, reject) => { rejectA = reject; });
            behaviorByModel.b = () => new Promise<void>((_resolve, reject) => { rejectB = reject; });
            const { result } = renderHook(() => useHarness("conv_1"));

            let pending!: Promise<void>;
            act(() => {
                pending = result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["a", "b"] });
            });
            expect(streamClientInstances).toHaveLength(2);

            act(() => {
                result.current.stopAll();
            });
            expect(streamClientInstances[0].abort).toHaveBeenCalledTimes(1);
            expect(streamClientInstances[1].abort).toHaveBeenCalledTimes(1);

            rejectA(abortError());
            rejectB(abortError());
            await act(async () => {
                await pending;
            });

            expect(result.current.messages[0].error).toBeUndefined();
            expect(result.current.messages[1].error).toBeUndefined();
        });

        it("is a no-op the second time (does not throw when there are no clients left)", () => {
            const { result } = renderHook(() => useHarness("conv_1"));
            expect(() => {
                act(() => {
                    result.current.stopAll();
                    result.current.stopAll();
                });
            }).not.toThrow();
        });
    });

    describe("unmount", () => {
        it("aborts all in-flight clients when the component unmounts", async () => {
            let rejectA!: (err: unknown) => void;
            behaviorByModel.a = () => new Promise<void>((_resolve, reject) => { rejectA = reject; });
            const { result, unmount } = renderHook(() => useHarness("conv_1"));

            let pending!: Promise<void>;
            act(() => {
                pending = result.current.streamMultiple({ userMessageId: "u1", userContent: "hi", models: ["a"] });
            });
            expect(streamClientInstances).toHaveLength(1);

            unmount();
            expect(streamClientInstances[0].abort).toHaveBeenCalledTimes(1);

            rejectA(abortError());
            await expect(pending).resolves.toBeUndefined();
        });
    });

    describe("retryFailedMessage", () => {
        it("does nothing when the failed message lacks model_id or parent_id", async () => {
            const { result } = renderHook(() => useHarness("conv_1"));

            await act(async () => {
                await result.current.retryFailedMessage(
                    { id: "m1", role: "assistant", content: "" } as Message,
                    "retry text"
                );
            });

            expect(result.current.messages).toHaveLength(0);
            expect(StreamClientMock).not.toHaveBeenCalled();
        });

        it("resets the failed slot in place before re-streaming, then reflects the recovered content", async () => {
            behaviorByModel["gpt-4o"] = (_config, callbacks) => {
                callbacks.onContent("recovered", "");
            };
            const { result } = renderHook(() => useHarness("conv_1"));

            act(() => {
                result.current.setMessages([
                    {
                        id: "asst_1",
                        role: "assistant",
                        content: "",
                        model_id: "gpt-4o",
                        parent_id: "user_1",
                        error: "boom",
                        tool_calls: [{ id: "x", name: "y", arguments: "{}" }],
                    },
                ]);
            });

            let pending!: Promise<void>;
            act(() => {
                pending = result.current.retryFailedMessage(result.current.messages[0], "retry text");
            });

            // The reset happens synchronously, before the (mocked) stream resolves.
            expect(result.current.messages[0]).toMatchObject({
                id: "asst_1",
                content: "",
                error: undefined,
                generation_id: undefined,
                tool_calls: undefined,
            });

            await act(async () => {
                await pending;
            });

            expect(result.current.messages[0]).toMatchObject({
                id: "asst_1",
                content: "recovered",
                error: undefined,
            });
        });

        it("forwards enabledMcpServerIds and a fresh per-model config to the retried stream", async () => {
            behaviorByModel["gpt-4o"] = () => undefined;
            const { result } = renderHook(() => useHarness("conv_1"));

            act(() => {
                result.current.setMessages([
                    { id: "asst_1", role: "assistant", content: "", model_id: "gpt-4o", parent_id: "user_1" },
                ]);
            });

            await act(async () => {
                await result.current.retryFailedMessage(
                    result.current.messages[0],
                    "retry text",
                    () => ({ temperature: 0.7 }),
                    ["github"]
                );
            });

            const config = streamClientInstances[0].stream.mock.calls[0][0];
            expect(config).toMatchObject({
                userMessageId: "user_1",
                parentMessageId: "user_1",
                assistantMessageId: "asst_1",
                model: "gpt-4o",
                enabledMcpServerIds: ["github"],
                additionalConfig: { temperature: 0.7 },
            });
        });
    });
});
