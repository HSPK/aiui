// Coverage for components/playground/message-list.tsx — date-separator
// injection, sibling grouping/selection, last-assistant-index tracking,
// and the `foldToolMessages` tool-result folding helper. `ChatMessage`
// itself has its own dedicated coverage in chat-message.test.tsx, so it's
// stubbed here to isolate MessageList's own orchestration logic.
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient, resetPlaygroundStores } from "./_render";
import { MessageList } from "@/components/playground/message-list";
import type { Message } from "@/components/playground/chat/types";
import type { ContentPart } from "@/lib/schemas/content";

const modelsUseListMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/models", () => ({
    models: { useList: (...args: unknown[]) => modelsUseListMock(...args) },
}));

// Stub ChatMessage: capture every prop MessageList computed for it so
// assertions can target MessageList's own orchestration (folding,
// sibling grouping/selection, isTyping/isLastAssistant derivation)
// without re-testing ChatMessage's internal rendering.
const chatMessageSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/playground/chat-message", () => ({
    ChatMessage: (props: {
        message: Message;
        provider?: string;
        isTyping?: boolean;
        isLastAssistant?: boolean;
        isLoading?: boolean;
        isSibling?: boolean;
        siblingCount?: number;
        isSelected?: boolean;
        onSelect?: () => void;
        onRegenerate?: () => void;
        onRetryFailed?: (id: string) => void;
    }) => {
        chatMessageSpy(props);
        const meta = {
            provider: props.provider ?? null,
            isTyping: !!props.isTyping,
            isLastAssistant: !!props.isLastAssistant,
            isLoading: !!props.isLoading,
            isSibling: !!props.isSibling,
            siblingCount: props.siblingCount ?? null,
            isSelected: !!props.isSelected,
            hasOnSelect: !!props.onSelect,
            hasOnRegenerate: !!props.onRegenerate,
            hasOnRetryFailed: !!props.onRetryFailed,
            toolCallsCount: props.message.tool_calls?.length ?? 0,
            toolCalls: props.message.tool_calls ?? null,
        };
        return (
            <div data-testid={`msg-${props.message.id}`} onClick={props.onSelect}>
                <span data-testid="role">{props.message.role}</span>
                <span data-testid="content">
                    {typeof props.message.content === "string" ? props.message.content : "[complex]"}
                </span>
                <span data-testid="meta">{JSON.stringify(meta)}</span>
            </div>
        );
    },
}));

function makeMsg(overrides: Partial<Message> = {}): Message {
    return {
        id: "m1",
        role: "assistant",
        content: "hello",
        created_at: "2024-06-15T12:00:00.000Z",
        ...overrides,
    };
}

function getMeta(id: string) {
    const el = screen.getByTestId(`msg-${id}`);
    return JSON.parse(within(el).getByTestId("meta").textContent ?? "{}");
}

function renderList(overrides: Partial<React.ComponentProps<typeof MessageList>> = {}) {
    const props: React.ComponentProps<typeof MessageList> = {
        messages: [],
        isLoading: false,
        ...overrides,
    };
    return renderWithClient(<MessageList {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    modelsUseListMock.mockReturnValue({ data: [] });
});

afterEach(() => {
    resetPlaygroundStores();
    vi.useRealTimers();
});

describe("MessageList — empty state", () => {
    it("shows the empty-conversation placeholder when there are no messages", () => {
        const { container } = renderList({ messages: [] });
        expect(screen.getByText("Start a conversation...")).toBeInTheDocument();
        expect(container.querySelector("svg.lucide-bot")).toBeInTheDocument();
    });

    it("does not show the placeholder once there is at least one message", () => {
        renderList({ messages: [makeMsg()] });
        expect(screen.queryByText("Start a conversation...")).not.toBeInTheDocument();
    });
});

describe("MessageList — date separators", () => {
    it("groups same-day messages under a single 'Today' separator", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-15T18:00:00.000Z"));
        renderList({
            messages: [
                makeMsg({ id: "a", role: "user", created_at: "2024-06-15T10:00:00.000Z" }),
                makeMsg({ id: "b", role: "assistant", created_at: "2024-06-15T10:05:00.000Z" }),
            ],
        });
        expect(screen.getAllByText("Today")).toHaveLength(1);
    });

    it("labels yesterday's messages 'Yesterday' and starts a new separator per day", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-15T18:00:00.000Z"));
        renderList({
            messages: [
                makeMsg({ id: "a", role: "user", created_at: "2024-06-14T10:00:00.000Z" }),
                makeMsg({ id: "b", role: "assistant", created_at: "2024-06-15T10:05:00.000Z" }),
            ],
        });
        expect(screen.getByText("Yesterday")).toBeInTheDocument();
        expect(screen.getByText("Today")).toBeInTheDocument();
    });

    it("formats a same-year older date as 'Month d'", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-15T18:00:00.000Z"));
        renderList({ messages: [makeMsg({ id: "a", created_at: "2024-01-03T10:00:00.000Z" })] });
        expect(screen.getByText("January 3")).toBeInTheDocument();
    });

    it("formats a prior-year date as 'Month d, yyyy'", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-15T18:00:00.000Z"));
        renderList({ messages: [makeMsg({ id: "a", created_at: "2022-01-03T10:00:00.000Z" })] });
        expect(screen.getByText("January 3, 2022")).toBeInTheDocument();
    });

    it("falls back to the current time for the separator date when a message has no created_at", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-15T18:00:00.000Z"));
        renderList({ messages: [makeMsg({ id: "a", created_at: undefined })] });
        expect(screen.getByText("Today")).toBeInTheDocument();
    });
});

describe("MessageList — provider resolution & per-message flags", () => {
    it("resolves the provider by matching model_id against the models list's model_id or name field", () => {
        modelsUseListMock.mockReturnValue({
            data: [
                { name: "gpt-4o-alias", model_id: "gpt-4o", provider: "openai" },
                { name: "local-llama", model_id: null, provider: "ollama" },
            ],
        });
        renderList({
            messages: [
                makeMsg({ id: "a", model_id: "gpt-4o" }),
                makeMsg({ id: "b", model_id: "local-llama" }),
                makeMsg({ id: "c", model_id: "unknown-model" }),
            ],
        });
        expect(getMeta("a").provider).toBe("openai");
        expect(getMeta("b").provider).toBe("ollama");
        expect(getMeta("c").provider).toBeNull();
    });

    it("skips a models-list entry that has no provider set, and tolerates a still-loading (undefined) models list", () => {
        modelsUseListMock.mockReturnValue({ data: undefined });
        renderList({ messages: [makeMsg({ id: "a", model_id: "gpt-4o" })] });
        expect(getMeta("a").provider).toBeNull();

        modelsUseListMock.mockReturnValue({ data: [{ name: "gpt-4o", model_id: "gpt-4o", provider: null }] });
        renderList({ messages: [makeMsg({ id: "b", model_id: "gpt-4o" })] });
        expect(getMeta("b").provider).toBeNull();
    });

    it("marks an in-flight assistant message (no generation_id/error yet) as typing only while isLoading", () => {
        renderList({
            isLoading: true,
            messages: [makeMsg({ id: "a", role: "assistant" })],
        });
        expect(getMeta("a").isTyping).toBe(true);
    });

    it("does not mark a settled assistant message (generation_id set) as typing even while isLoading", () => {
        renderList({
            isLoading: true,
            messages: [makeMsg({ id: "a", role: "assistant", generation_id: "gen-1" })],
        });
        expect(getMeta("a").isTyping).toBe(false);
    });

    it("does not mark a failed assistant message (error set) as typing", () => {
        renderList({
            isLoading: true,
            messages: [makeMsg({ id: "a", role: "assistant", error: "boom" })],
        });
        expect(getMeta("a").isTyping).toBe(false);
    });

    it("never marks a user message as typing", () => {
        renderList({
            isLoading: true,
            messages: [makeMsg({ id: "a", role: "user" })],
        });
        expect(getMeta("a").isTyping).toBe(false);
    });

    it("only forwards onRegenerate/onRetryFailed to assistant messages, not user messages", () => {
        const onRegenerate = vi.fn();
        const onRetryFailed = vi.fn();
        renderList({
            onRegenerate,
            onRetryFailed,
            messages: [
                makeMsg({ id: "u", role: "user" }),
                makeMsg({ id: "a", role: "assistant" }),
            ],
        });
        expect(getMeta("u").hasOnRegenerate).toBe(false);
        expect(getMeta("u").hasOnRetryFailed).toBe(false);
        expect(getMeta("a").hasOnRegenerate).toBe(true);
        expect(getMeta("a").hasOnRetryFailed).toBe(true);
    });

    it("marks only the single trailing assistant message as isLastAssistant", () => {
        renderList({
            messages: [
                makeMsg({ id: "u1", role: "user" }),
                makeMsg({ id: "a1", role: "assistant" }),
                makeMsg({ id: "u2", role: "user" }),
                makeMsg({ id: "a2", role: "assistant" }),
            ],
        });
        expect(getMeta("a1").isLastAssistant).toBe(false);
        expect(getMeta("a2").isLastAssistant).toBe(true);
    });
});

describe("MessageList — sibling grouping & selection", () => {
    function siblingMessages(overrides: Partial<Message>[] = []): Message[] {
        return [
            makeMsg({ id: "root", role: "user", created_at: "2024-06-15T09:00:00.000Z" }),
            makeMsg({
                id: "s0",
                role: "assistant",
                parent_id: "root",
                created_at: "2024-06-15T09:01:00.000Z",
                content: "first try",
                ...overrides[0],
            }),
            makeMsg({
                id: "s1",
                role: "assistant",
                parent_id: "root",
                created_at: "2024-06-15T09:02:00.000Z",
                content: "second try",
                ...overrides[1],
            }),
        ];
    }

    it("renders every sibling in the group side-by-side, tagged with the group's siblingCount", () => {
        renderList({ messages: siblingMessages() });
        expect(screen.getByTestId("msg-s0")).toBeInTheDocument();
        expect(screen.getByTestId("msg-s1")).toBeInTheDocument();
        expect(getMeta("s0").isSibling).toBe(true);
        expect(getMeta("s0").siblingCount).toBe(2);
        expect(getMeta("s1").siblingCount).toBe(2);
    });

    it("resolves each sibling's own provider from its model_id, same as a non-sibling message", () => {
        modelsUseListMock.mockReturnValue({ data: [{ name: "gpt-4o", model_id: "gpt-4o", provider: "openai" }] });
        renderList({ messages: siblingMessages([{ model_id: "gpt-4o" }, { model_id: "unknown" }]) });
        expect(getMeta("s0").provider).toBe("openai");
        expect(getMeta("s1").provider).toBeNull();
    });

    it("marks a sibling as typing only while isLoading and it has neither a generation_id nor an error", () => {
        renderList({ messages: siblingMessages([{}, { generation_id: "gen-1" }]), isLoading: true });
        expect(getMeta("s0").isTyping).toBe(true);
        expect(getMeta("s1").isTyping).toBe(false);
    });

    it("never marks a sibling as typing while isLoading is false, even without a generation_id/error", () => {
        renderList({ messages: siblingMessages(), isLoading: false });
        expect(getMeta("s0").isTyping).toBe(false);
        expect(getMeta("s1").isTyping).toBe(false);
    });

    it("does not mark a failed sibling (error set) as typing even while isLoading", () => {
        renderList({ messages: siblingMessages([{}, { error: "boom" }]), isLoading: true });
        expect(getMeta("s1").isTyping).toBe(false);
    });

    it("gives the sibling group its own date separator when its day differs from the preceding message's day", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-16T18:00:00.000Z"));
        const messages = siblingMessages();
        // Push both siblings a full day later than `root`, and prepend an
        // earlier same-day-as-root message so the group's own date check
        // (as opposed to the leading, non-sibling messages') is exercised.
        messages[1] = { ...messages[1], created_at: "2024-06-16T09:01:00.000Z" };
        messages[2] = { ...messages[2], created_at: "2024-06-16T09:02:00.000Z" };
        renderList({ messages });
        expect(screen.getByText("Yesterday")).toBeInTheDocument();
        expect(screen.getByText("Today")).toBeInTheDocument();
    });

    it("defaults to selecting the LAST sibling when nothing else determines an active one", () => {
        renderList({ messages: siblingMessages() });
        expect(getMeta("s0").isSelected).toBe(false);
        expect(getMeta("s1").isSelected).toBe(true);
    });

    it("selects the sibling referenced as parent_id by a later message (conversation flow) over the default-last", () => {
        const messages = siblingMessages();
        messages.push(makeMsg({
            id: "u2",
            role: "user",
            parent_id: "s0",
            created_at: "2024-06-15T09:03:00.000Z",
        }));
        renderList({ messages });
        expect(getMeta("s0").isSelected).toBe(true);
        expect(getMeta("s1").isSelected).toBe(false);
    });

    it("prioritises the selectedSiblings prop over both the default-last and the active-conversation sibling", () => {
        const messages = siblingMessages();
        messages.push(makeMsg({ id: "u2", role: "user", parent_id: "s1", created_at: "2024-06-15T09:03:00.000Z" }));
        renderList({ messages, selectedSiblings: new Map([["root", 0]]) });
        expect(getMeta("s0").isSelected).toBe(true);
        expect(getMeta("s1").isSelected).toBe(false);
    });

    it("invokes onSelectSibling with the parent id and clicked index when the head-of-conversation group is clicked", async () => {
        const user = userEvent.setup();
        const onSelectSibling = vi.fn();
        renderList({ messages: siblingMessages(), onSelectSibling });

        await user.click(screen.getByTestId("msg-s0"));
        expect(onSelectSibling).toHaveBeenCalledWith("root", 0);
    });

    it("does not allow selection (no onSelect wired) once the sibling group is no longer the head of the conversation", () => {
        const messages = siblingMessages();
        messages.push(makeMsg({ id: "u2", role: "user", created_at: "2024-06-15T09:03:00.000Z" }));
        renderList({ messages, onSelectSibling: vi.fn() });
        expect(getMeta("s0").hasOnSelect).toBe(false);
        expect(getMeta("s1").hasOnSelect).toBe(false);
    });

    it("allows selection when the sibling group IS the head of the conversation", () => {
        renderList({ messages: siblingMessages(), onSelectSibling: vi.fn() });
        expect(getMeta("s0").hasOnSelect).toBe(true);
        expect(getMeta("s1").hasOnSelect).toBe(true);
    });

    it("does not render a lone assistant message (no siblings sharing its parent_id) as a sibling group", () => {
        renderList({
            messages: [
                makeMsg({ id: "root", role: "user" }),
                makeMsg({ id: "solo", role: "assistant", parent_id: "root" }),
            ],
        });
        expect(getMeta("solo").isSibling).toBe(false);
    });

    it("marks the selected sibling as isLastAssistant when its group is the trailing message", () => {
        renderList({ messages: siblingMessages() });
        expect(getMeta("s0").isLastAssistant).toBe(false);
        expect(getMeta("s1").isLastAssistant).toBe(true);
    });
});

describe("MessageList — foldToolMessages", () => {
    function toolCallPart(id: string, name = "search"): ContentPart {
        return { type: "tool_call", tool_call: { id, name, arguments: "{}" } } as ContentPart;
    }
    function toolResultMessage(id: string, callId: string, content = "result body"): Message {
        return makeMsg({
            id,
            role: "tool",
            content: [{ type: "tool_result", tool_result: { tool_call_id: callId, content } }] as unknown as Message["content"],
        });
    }

    it("folds a matching tool_result into the preceding assistant message's tool_calls and drops the standalone tool row", () => {
        renderList({
            messages: [
                makeMsg({ id: "a", role: "assistant", content: [toolCallPart("call-1")] as unknown as Message["content"] }),
                toolResultMessage("t1", "call-1"),
            ],
        });
        expect(getMeta("a").toolCallsCount).toBe(1);
        expect(screen.queryByTestId("msg-t1")).not.toBeInTheDocument();
    });

    it("keeps an orphan tool row (its call id is not known to any loaded assistant message) as a standalone message", () => {
        renderList({
            messages: [toolResultMessage("t-orphan", "call-unknown")],
        });
        expect(screen.getByTestId("msg-t-orphan")).toBeInTheDocument();
        expect(within(screen.getByTestId("msg-t-orphan")).getByTestId("role").textContent).toBe("tool");
    });

    it("leaves an assistant message with no tool_call parts unaffected (still a plain string body)", () => {
        renderList({ messages: [makeMsg({ id: "a", content: "just text" })] });
        expect(getMeta("a").toolCallsCount).toBe(0);
        expect(screen.getByTestId("content").textContent).toBe("just text");
    });

    it("leaves an assistant message with array (multimodal) content but no tool_call parts unaffected", () => {
        renderList({
            messages: [makeMsg({ id: "a", content: [{ type: "text", text: "hi" }] as unknown as Message["content"] })],
        });
        expect(getMeta("a").toolCallsCount).toBe(0);
        expect(screen.getByTestId("content").textContent).toBe("[complex]");
    });

    it("leaves a tool_call's result unset while its matching tool_result hasn't arrived yet (in-flight call)", () => {
        renderList({
            messages: [makeMsg({ id: "a", role: "assistant", content: [toolCallPart("call-pending")] as unknown as Message["content"] })],
        });
        const meta = getMeta("a");
        expect(meta.toolCallsCount).toBe(1);
        expect(meta.toolCalls[0].result).toBeUndefined();
    });
});
