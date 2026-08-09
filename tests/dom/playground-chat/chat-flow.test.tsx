// Coverage for components/playground/chat-flow.tsx — the playground's
// per-conversation orchestrator. Its OWN logic (as opposed to the
// hooks/components it wires together) is: seeding initial messages from
// the query cache, the `blockedByFailedTail` tail-walk, the MCP
// allow-list computation, the URL `?c=` sync effect, submit/regenerate/
// retry request shaping, the initial-loading vs message-list branch,
// and LogDetails open/close.
//
// Every dependency below is independently owned/tested elsewhere (the
// `hooks` barrel, `use-playground-chat`, `MessageList`, `ChatInput`,
// `LogDetails`, `@/lib/api/mcp`) per the assignment — all stubbed here
// to isolate ChatFlow's own glue code. `usePlaygroundStore` and
// `useModalityStore` are real (per the harness convention) since
// ChatFlow reads/writes them directly via `getState()`.
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithClient, resetPlaygroundStores } from "./_render";
import { ChatFlow } from "@/components/playground/chat-flow";
import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { useModalityStore } from "@/lib/stores/modality-store";
import type { Message } from "@/components/playground/chat/types";

// ---- hook barrel + siblings ----

const useChatScrollMock = vi.hoisted(() => vi.fn());
const usePaginatedMessagesMock = vi.hoisted(() => vi.fn());
const useChatConfigMock = vi.hoisted(() => vi.fn());
const useSiblingNavigationMock = vi.hoisted(() => vi.fn());
const useContextAssistantMock = vi.hoisted(() => vi.fn());
const useTitleGenerationMock = vi.hoisted(() => vi.fn());
const useMessageSyncMock = vi.hoisted(() => vi.fn());
const useModelConfigsMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/playground/hooks", () => ({
    useChatScroll: (...args: unknown[]) => useChatScrollMock(...args),
    usePaginatedMessages: (...args: unknown[]) => usePaginatedMessagesMock(...args),
    useChatConfig: (...args: unknown[]) => useChatConfigMock(...args),
    useSiblingNavigation: (...args: unknown[]) => useSiblingNavigationMock(...args),
    useContextAssistant: (...args: unknown[]) => useContextAssistantMock(...args),
    useTitleGeneration: (...args: unknown[]) => useTitleGenerationMock(...args),
    useMessageSync: (...args: unknown[]) => useMessageSyncMock(...args),
    useModelConfigs: (...args: unknown[]) => useModelConfigsMock(...args),
}));

const readCachedMessagesMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/playground/hooks/use-paginated-messages", () => ({
    readCachedMessages: (...args: unknown[]) => readCachedMessagesMock(...args),
}));

const usePlaygroundChatMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/playground/use-playground-chat", () => ({
    usePlaygroundChat: (...args: unknown[]) => usePlaygroundChatMock(...args),
}));

const mcpServersUseListMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/mcp", () => ({
    mcpServers: { useList: (...args: unknown[]) => mcpServersUseListMock(...args) },
}));

const logDetailsSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/logs/log-details-lazy", () => ({
    LogDetails: (props: { logId: string; open: boolean; onOpenChange: (open: boolean) => void }) => {
        logDetailsSpy(props);
        return (
            <div data-testid="log-details" data-log-id={props.logId}>
                <button onClick={() => props.onOpenChange(false)}>close-log-details</button>
            </div>
        );
    },
}));

const messageListSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/playground/message-list", () => ({
    MessageList: (props: {
        messages: Message[];
        isLoading: boolean;
        onViewGeneration?: (id: string) => void;
        onRegenerate?: () => void;
        onRetryFailed?: (id: string) => void;
        selectedSiblings?: Map<string, number>;
        onSelectSibling?: (parentId: string, index: number) => void;
    }) => {
        messageListSpy(props);
        return (
            <div data-testid="message-list">
                <span data-testid="message-count">{props.messages.length}</span>
                <button onClick={() => props.onViewGeneration?.("gen-42")}>fake-view-generation</button>
                <button onClick={() => props.onRegenerate?.()}>fake-regenerate</button>
                <button onClick={() => props.onRetryFailed?.("failed-assistant-1")}>fake-retry-failed</button>
            </div>
        );
    },
}));

const chatInputSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/playground/chat-input", () => ({
    ChatInput: (props: {
        conversationId: string;
        onSubmit: (content: unknown) => void;
        isLoading: boolean;
        onStop: () => void;
        blockedByFailedTail?: boolean;
    }) => {
        chatInputSpy(props);
        return (
            <div data-testid="chat-input" data-blocked={String(!!props.blockedByFailedTail)}>
                <button onClick={() => props.onSubmit("hello")}>fake-submit</button>
                <button onClick={() => props.onStop()}>fake-stop</button>
            </div>
        );
    },
}));

// ---- fixtures ----

function makeMsg(overrides: Partial<Message> = {}): Message {
    return { id: "m1", role: "assistant", content: "hi", ...overrides };
}

function defaultChatScrollReturn(overrides: Partial<ReturnType<typeof useChatScrollMock>> = {}) {
    return {
        viewportRef: { current: null },
        showScrollBottom: false,
        handleScroll: vi.fn(),
        scrollToBottom: vi.fn(),
        preserveScrollPosition: (fn: () => void) => fn(),
        ...overrides,
    };
}

function defaultPlaygroundChatReturn(overrides: Record<string, unknown> = {}) {
    return {
        messages: [] as Message[],
        handleSubmit: vi.fn(),
        handleRetryFailed: vi.fn(),
        handleRegenerate: vi.fn(),
        isLoading: false,
        setMessages: vi.fn(),
        error: null,
        stop: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    useChatScrollMock.mockReturnValue(defaultChatScrollReturn());
    usePaginatedMessagesMock.mockReturnValue({
        hasMore: false,
        loadMore: vi.fn(),
        isLoadingMore: false,
        isInitialLoading: false,
    });
    useChatConfigMock.mockReturnValue({ historyLimit: 20, systemPrompt: "be nice", singleModelMode: false });
    useSiblingNavigationMock.mockReturnValue({
        selectedSiblings: new Map(),
        onSelectSibling: vi.fn(),
        getSelectedIndex: vi.fn(),
    });
    useContextAssistantMock.mockReturnValue({ contextAssistantId: undefined, contextAssistantIdRef: { current: undefined } });
    useTitleGenerationMock.mockReturnValue(undefined);
    useMessageSyncMock.mockReturnValue(undefined);
    useModelConfigsMock.mockReturnValue({
        modelConfigs: {},
        getModelConfig: vi.fn(),
        updateModelConfig: vi.fn(),
        removeModelConfig: vi.fn(),
        buildConfigForModel: vi.fn((modelId: string, historyLimit?: number, systemPrompt?: string) => ({
            modelId,
            historyLimit,
            systemPrompt,
        })),
    });
    readCachedMessagesMock.mockReturnValue(null);
    mcpServersUseListMock.mockReturnValue({ data: [] });
    usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn());
});

afterEach(() => {
    resetPlaygroundStores();
});

describe("ChatFlow — hook wiring & initial cache seeding", () => {
    it("reads the cached initial page via readCachedMessages(queryClient, conversationId, 20) and feeds it to usePlaygroundChat", () => {
        const cached = [makeMsg({ id: "cached-1" })];
        readCachedMessagesMock.mockReturnValue(cached);
        const { queryClient } = renderWithClient(<ChatFlow conversationId="conv-1" />);

        expect(readCachedMessagesMock).toHaveBeenCalledWith(queryClient, "conv-1", 20);
        expect(usePlaygroundChatMock).toHaveBeenCalledWith(
            expect.objectContaining({ conversationId: "conv-1", initialMessages: cached })
        );
    });

    it("falls back to an empty array when there's no cached page", () => {
        readCachedMessagesMock.mockReturnValue(null);
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(usePlaygroundChatMock).toHaveBeenCalledWith(
            expect.objectContaining({ initialMessages: [] })
        );
    });

    it("passes conversationId through to ChatInput, and messages/isLoading through to MessageList", () => {
        usePlaygroundChatMock.mockReturnValue(
            defaultPlaygroundChatReturn({ messages: [makeMsg({ id: "a" }), makeMsg({ id: "b" })], isLoading: true })
        );
        renderWithClient(<ChatFlow conversationId="conv-9" />);

        expect(chatInputSpy).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv-9", isLoading: true }));
        expect(messageListSpy).toHaveBeenCalledWith(expect.objectContaining({ isLoading: true }));
        expect(screen.getByTestId("message-count")).toHaveTextContent("2");
    });
});

describe("ChatFlow — initial loading state", () => {
    it("shows a loading spinner instead of MessageList while isInitialLoading and there are no messages yet", () => {
        usePaginatedMessagesMock.mockReturnValue({ hasMore: false, loadMore: vi.fn(), isLoadingMore: false, isInitialLoading: true });
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(screen.getByText("Loading conversation…")).toBeInTheDocument();
        expect(screen.queryByTestId("message-list")).not.toBeInTheDocument();
    });

    it("prefers showing MessageList over the spinner once a cache hit already provided messages", () => {
        usePaginatedMessagesMock.mockReturnValue({ hasMore: false, loadMore: vi.fn(), isLoadingMore: false, isInitialLoading: true });
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ messages: [makeMsg()] }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(screen.queryByText("Loading conversation…")).not.toBeInTheDocument();
        expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });

    it("shows MessageList once isInitialLoading settles to false", () => {
        usePaginatedMessagesMock.mockReturnValue({ hasMore: false, loadMore: vi.fn(), isLoadingMore: false, isInitialLoading: false });
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(screen.getByTestId("message-list")).toBeInTheDocument();
    });
});

describe("ChatFlow — blockedByFailedTail", () => {
    function expectBlocked(messages: Message[], expected: boolean) {
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ messages }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(screen.getByTestId("chat-input")).toHaveAttribute("data-blocked", String(expected));
    }

    it("is false with no messages at all", () => expectBlocked([], false));

    it("is false while the trailing assistant slot is still streaming (no generation_id, no error yet)", () => {
        expectBlocked([makeMsg({ id: "a", role: "assistant" })], false);
    });

    it("is true when the trailing assistant slot has an error", () => {
        expectBlocked([makeMsg({ id: "a", role: "assistant", error: "boom" })], true);
    });

    it("is false when the trailing assistant slot settled cleanly (has a generation_id)", () => {
        expectBlocked([makeMsg({ id: "a", role: "assistant", generation_id: "gen-1" })], false);
    });

    it("walks back past a trailing user message to find the last assistant's outcome", () => {
        expectBlocked(
            [
                makeMsg({ id: "a", role: "assistant", error: "boom" }),
                makeMsg({ id: "u", role: "user", content: "retry?" }),
            ],
            true
        );
    });

    it("does not gate on user/tool messages when the conversation has no assistant turn yet", () => {
        expectBlocked([makeMsg({ id: "u", role: "user", content: "hi" })], false);
    });
});

describe("ChatFlow — submit / regenerate / retry request shaping", () => {
    it("falls back to the gpt-3.5-turbo default model when no model is selected for the conversation", async () => {
        const handleSubmit = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleSubmit }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-submit"));
        });

        expect(handleSubmit).toHaveBeenCalledExactlyOnceWith(
            "hello",
            expect.objectContaining({ models: ["gpt-3.5-turbo"] })
        );
    });

    it("uses the conversation's own selected models when present, and threads contextMessageId + MCP ids through", async () => {
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv-1", { modelIds: ["gpt-4o", "claude"] });
        });
        useContextAssistantMock.mockReturnValue({ contextAssistantId: "ctx-1", contextAssistantIdRef: { current: "ctx-1" } });
        mcpServersUseListMock.mockReturnValue({
            data: [
                { id: "mcp-a", enabled: true, last_check_status: "ok" },
                { id: "mcp-b", enabled: true, last_check_status: "error" },
                { id: "mcp-c", enabled: false, last_check_status: "ok" },
            ],
        });
        const handleSubmit = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleSubmit }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-submit"));
        });

        expect(handleSubmit).toHaveBeenCalledExactlyOnceWith(
            "hello",
            expect.objectContaining({
                models: ["gpt-4o", "claude"],
                contextMessageId: "ctx-1",
                enabledMcpServerIds: ["mcp-a"],
            })
        );
    });

    it("excludes an MCP server explicitly disabled for this conversation from the enabled id list", async () => {
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv-1", { disabledMcpServerIds: ["mcp-a"] });
        });
        mcpServersUseListMock.mockReturnValue({
            data: [
                { id: "mcp-a", enabled: true, last_check_status: "ok" },
                { id: "mcp-b", enabled: true, last_check_status: "ok" },
            ],
        });
        const handleSubmit = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleSubmit }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-submit"));
        });
        expect(handleSubmit).toHaveBeenCalledExactlyOnceWith(
            "hello",
            expect.objectContaining({ enabledMcpServerIds: ["mcp-b"] })
        );
    });

    it("wires buildConfigForModel(modelId, historyLimit, systemPrompt) as getModelConfig for the submit request", async () => {
        const buildConfigForModel = vi.fn((modelId: string) => ({ modelId }));
        useModelConfigsMock.mockReturnValue({
            modelConfigs: {},
            getModelConfig: vi.fn(),
            updateModelConfig: vi.fn(),
            removeModelConfig: vi.fn(),
            buildConfigForModel,
        });
        useChatConfigMock.mockReturnValue({ historyLimit: 7, systemPrompt: "sys", singleModelMode: false });
        const handleSubmit = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleSubmit }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-submit"));
        });
        const getModelConfig = handleSubmit.mock.calls[0][1].getModelConfig as (id: string) => unknown;
        getModelConfig("gpt-4o");
        expect(buildConfigForModel).toHaveBeenCalledWith("gpt-4o", 7, "sys");
    });

    it("regenerates using the conversation's raw selected models (no gpt-3.5-turbo fallback) and the MCP allow-list", async () => {
        const handleRegenerate = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleRegenerate }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-regenerate"));
        });
        expect(handleRegenerate).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ models: [], enabledMcpServerIds: [] })
        );
    });

    it("retries the specific failed assistant id passed up from MessageList", async () => {
        const handleRetryFailed = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleRetryFailed }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-retry-failed"));
        });
        expect(handleRetryFailed).toHaveBeenCalledExactlyOnceWith(
            "failed-assistant-1",
            expect.objectContaining({ models: [] })
        );
    });

    it("treats an undefined MCP server list (query still loading) as no servers enabled, rather than throwing", async () => {
        mcpServersUseListMock.mockReturnValue({ data: undefined });
        const handleSubmit = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ handleSubmit }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText("fake-submit"));
        });
        expect(handleSubmit).toHaveBeenCalledExactlyOnceWith(
            "hello",
            expect.objectContaining({ enabledMcpServerIds: [] })
        );
    });

    it("wires ChatInput's onStop directly to usePlaygroundChat's stop", async () => {
        const stop = vi.fn();
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ stop }));
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        await act(async () => {
            fireEvent.click(screen.getByText("fake-stop"));
        });
        expect(stop).toHaveBeenCalledOnce();
    });
});

describe("ChatFlow — URL ?c= sync effect", () => {
    it("does not touch the URL while there are no messages yet", async () => {
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");
        window.history.replaceState({}, "", "/playground/chat");
        replaceStateSpy.mockClear();
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        await Promise.resolve();
        expect(replaceStateSpy).not.toHaveBeenCalled();
        replaceStateSpy.mockRestore();
    });

    it("adds ?c=<conversationId> once messages exist and the URL doesn't already carry it", async () => {
        window.history.replaceState({}, "", "/playground/chat");
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ messages: [makeMsg()] }));
        renderWithClient(<ChatFlow conversationId="conv-77" />);
        await act(async () => Promise.resolve());
        expect(new URL(window.location.href).searchParams.get("c")).toBe("conv-77");
    });

    it("does not call replaceState again once the URL already carries the matching ?c=", async () => {
        window.history.replaceState({}, "", "/playground/chat?c=conv-77");
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");
        usePlaygroundChatMock.mockReturnValue(defaultPlaygroundChatReturn({ messages: [makeMsg()] }));
        renderWithClient(<ChatFlow conversationId="conv-77" />);
        await act(async () => Promise.resolve());
        expect(replaceStateSpy).not.toHaveBeenCalled();
        replaceStateSpy.mockRestore();
    });
});

describe("ChatFlow — view generation / LogDetails", () => {
    it("opens LogDetails with the generation id reported by MessageList's onViewGeneration", async () => {
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(screen.queryByTestId("log-details")).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText("fake-view-generation"));
        });
        expect(screen.getByTestId("log-details")).toHaveAttribute("data-log-id", "gen-42");
    });

    it("closes LogDetails (clearing the selection) when onOpenChange(false) fires", async () => {
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        await act(async () => {
            fireEvent.click(screen.getByText("fake-view-generation"));
        });
        expect(screen.getByTestId("log-details")).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText("close-log-details"));
        });
        expect(screen.queryByTestId("log-details")).not.toBeInTheDocument();
    });
});

describe("ChatFlow — scroll-to-bottom affordance & scroll-offset restore", () => {
    it("shows the scroll-to-bottom button only when useChatScroll reports showScrollBottom, and wires the click to scrollToBottom", async () => {
        const scrollToBottom = vi.fn();
        useChatScrollMock.mockReturnValue(defaultChatScrollReturn({ showScrollBottom: true, scrollToBottom }));
        const { container } = renderWithClient(<ChatFlow conversationId="conv-1" />);
        const button = container.querySelector("button.absolute.-top-8") as HTMLButtonElement;
        expect(button).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(button);
        });
        expect(scrollToBottom).toHaveBeenCalledOnce();
    });

    it("hides the scroll-to-bottom button when showScrollBottom is false", () => {
        useChatScrollMock.mockReturnValue(defaultChatScrollReturn({ showScrollBottom: false }));
        const { container } = renderWithClient(<ChatFlow conversationId="conv-1" />);
        expect(container.querySelector("button.absolute.-top-8")).not.toBeInTheDocument();
    });

    it("wires useChatScroll's onLoadMore to loadMore, run through preserveScrollPosition", () => {
        const loadMore = vi.fn();
        usePaginatedMessagesMock.mockReturnValue({ hasMore: true, loadMore, isLoadingMore: false, isInitialLoading: false });
        renderWithClient(<ChatFlow conversationId="conv-1" />);

        const onLoadMore = useChatScrollMock.mock.calls[0][0].onLoadMore as () => void;
        act(() => onLoadMore());
        expect(loadMore).toHaveBeenCalledOnce();
    });

    it("does not carry a saved scroll offset — opening a conversation always lands on the newest message", () => {
        renderWithClient(<ChatFlow conversationId="conv-1" />);
        const args = useChatScrollMock.mock.calls[0][0];
        expect(args).not.toHaveProperty("savedScrollPosition");
        expect(args).not.toHaveProperty("onSaveScrollPosition");
    });
});
