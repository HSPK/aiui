// Coverage for components/playground/chat-message.tsx — the single
// message bubble: markdown body, reasoning block, tool-call rendering,
// attachments, rating/copy/regenerate/retry actions, and sibling-card
// display mode.
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient, resetDeviceSettingsStore } from "./_render";
import { ChatMessage } from "@/components/playground/chat-message";
import type { Message } from "@/components/playground/chat/types";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store";

const rateMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/conversations", () => ({
    messages: { rate: (...args: unknown[]) => rateMock(...args) },
}));

const usePreferencesGetMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: (...args: unknown[]) => usePreferencesGetMock(...args) },
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

const copyToClipboardMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clipboard", () => ({
    copyToClipboard: (...args: unknown[]) => copyToClipboardMock(...args),
}));

function setPrefs(overrides: Partial<UserPreferencesDTO> = {}) {
    usePreferencesGetMock.mockReturnValue({ data: { ...defaultUserPreferences, ...overrides } });
}

function baseMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: "m1",
        role: "assistant",
        content: "Hello world",
        created_at: "2024-06-15T12:00:00.000Z",
        ...overrides,
    };
}

function renderMessage(overrides: Partial<React.ComponentProps<typeof ChatMessage>> = {}) {
    const props: React.ComponentProps<typeof ChatMessage> = {
        message: baseMessage(),
        ...overrides,
    };
    return renderWithClient(<ChatMessage {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    setPrefs();
    copyToClipboardMock.mockResolvedValue(true);
    rateMock.mockResolvedValue(null);
});

afterEach(() => {
    resetDeviceSettingsStore();
});

describe("ChatMessage — basic rendering", () => {
    it("renders an assistant message with provider/model header and markdown body", () => {
        renderMessage({
            message: baseMessage({ model_id: "gpt-4o" }),
            provider: "openai",
        });
        expect(screen.getByText("openai / gpt-4o")).toBeInTheDocument();
        expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("falls back to 'Assistant' when there's no provider or model_id", () => {
        renderMessage({ message: baseMessage({ model_id: undefined }), provider: undefined });
        expect(screen.getByText("Assistant")).toBeInTheDocument();
    });

    it("shows just the model_id (no provider prefix) when provider is unknown", () => {
        renderMessage({ message: baseMessage({ model_id: "local-llama" }), provider: undefined });
        expect(screen.getByText("local-llama")).toBeInTheDocument();
    });

    it("renders a user message with the default userName/avatar when preferences haven't loaded", () => {
        usePreferencesGetMock.mockReturnValue({ data: undefined });
        renderMessage({ message: baseMessage({ role: "user", content: "Hi there" }) });
        expect(screen.getByText("User")).toBeInTheDocument();
        expect(screen.getByText("👤")).toBeInTheDocument();
        expect(screen.getByText("Hi there")).toBeInTheDocument();
    });

    it("renders a user message with the custom name/avatar from server preferences", () => {
        setPrefs({ user_name: "Ada", user_avatar: "🚀" });
        renderMessage({ message: baseMessage({ role: "user", content: "Hi there" }) });
        expect(screen.getByText("Ada")).toBeInTheDocument();
        expect(screen.getByText("🚀")).toBeInTheDocument();
    });

    it("shows the message timestamp chip when the device setting is on (default)", () => {
        renderMessage();
        // formatMessageTime renders HH:mm — assert the pattern rather than
        // a hardcoded value to stay timezone-agnostic.
        expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    });

    it("hides the timestamp chip when showTimestamps device setting is off", () => {
        renderMessage();
        expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();

        // Flips a real, already-subscribed store value on a mounted
        // component — must be wrapped in act() so React flushes the
        // resulting re-render before we assert.
        act(() => {
            useDeviceSettingsStore.getState().updateDeviceSettings({ showTimestamps: false });
        });
        expect(screen.queryByText(/^\d{2}:\d{2}$/)).not.toBeInTheDocument();
    });

    it("hides the avatar/name header entirely in 'bubble' render style", () => {
        setPrefs({ chat_bubble_style: "bubble" });
        renderMessage({ message: baseMessage({ model_id: "gpt-4o" }), provider: "openai" });
        expect(screen.queryByText("openai / gpt-4o")).not.toBeInTheDocument();
        // Body content still renders.
        expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("hides the avatar/name header entirely in 'minimal' render style", () => {
        setPrefs({ chat_bubble_style: "minimal" });
        renderMessage({ message: baseMessage({ model_id: "gpt-4o" }), provider: "openai" });
        expect(screen.queryByText("openai / gpt-4o")).not.toBeInTheDocument();
        expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("shows the avatar/name header in the default 'plain' render style", () => {
        renderMessage({ message: baseMessage({ model_id: "gpt-4o" }), provider: "openai" });
        expect(screen.getByText("openai / gpt-4o")).toBeInTheDocument();
    });
});

describe("ChatMessage — typing cursor", () => {
    it("shows the typing cursor for an assistant message with no content yet while typing", () => {
        const { container } = renderMessage({
            message: baseMessage({ content: "" }),
            isTyping: true,
        });
        expect(container.querySelector(".typing-cursor")).toBeInTheDocument();
    });

    it("does not show a typing cursor once content has streamed in and isTyping is false", () => {
        const { container } = renderMessage({ message: baseMessage({ content: "done" }), isTyping: false });
        expect(container.querySelector(".typing-cursor")).not.toBeInTheDocument();
    });

    it("never shows a cursor in 'instant' render mode even while typing", () => {
        setPrefs({ chat_render_mode: "instant" });
        const { container } = renderMessage({ message: baseMessage({ content: "" }), isTyping: true });
        expect(container.querySelector(".typing-cursor")).not.toBeInTheDocument();
    });

    it("never shows a cursor for user messages", () => {
        const { container } = renderMessage({
            message: baseMessage({ role: "user", content: "" }),
            isTyping: true,
        });
        expect(container.querySelector(".typing-cursor")).not.toBeInTheDocument();
    });

    it("progressively reveals content via the typewriter animation in 'typewriter' render mode", async () => {
        vi.useFakeTimers();
        try {
            setPrefs({ chat_render_mode: "typewriter", typewriter_cps: 1000 });
            renderMessage({ message: baseMessage({ content: "Hello typewriter world" }) });

            // Immediately after mount the rAF loop hasn't ticked yet, so
            // nothing (or very little) has been revealed.
            expect(screen.queryByText("Hello typewriter world")).not.toBeInTheDocument();

            // jsdom's requestAnimationFrame shim resolves on a timer;
            // advance it enough ticks for the full string (23 chars at
            // 1000 cps) to be revealed.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });
            expect(screen.getByText("Hello typewriter world")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("ChatMessage — reasoning block", () => {
    it("labels the trigger 'Reasoning...' while typing with no visible content yet", () => {
        renderMessage({
            message: baseMessage({ reasoning_content: "thinking it through", content: "" }),
            isTyping: true,
        });
        expect(screen.getByRole("button", { name: /Reasoning\.\.\./ })).toBeInTheDocument();
    });

    it("labels the trigger 'Reasoning process' once settled, and starts expanded", () => {
        renderMessage({
            message: baseMessage({ reasoning_content: "42 is the answer", content: "final answer" }),
        });
        expect(screen.getByRole("button", { name: /Reasoning process/ })).toBeInTheDocument();
        expect(screen.getByText("42 is the answer")).toBeVisible();
    });

    it("collapses the reasoning content when the trigger is clicked", async () => {
        const user = userEvent.setup();
        renderMessage({
            message: baseMessage({ reasoning_content: "42 is the answer", content: "final answer" }),
        });
        const trigger = screen.getByRole("button", { name: /Reasoning process/ });
        const contentRegion = screen.getByText("42 is the answer").closest('[data-slot="collapsible-content"]')!;
        expect(contentRegion).not.toHaveAttribute("hidden");

        await user.click(trigger);
        await waitFor(() => expect(contentRegion).toHaveAttribute("hidden"));
    });

    it("renders no reasoning trigger when reasoning_content is absent", () => {
        renderMessage({ message: baseMessage({ reasoning_content: undefined }) });
        expect(screen.queryByRole("button", { name: /Reasoning/ })).not.toBeInTheDocument();
    });
});

describe("ChatMessage — error / retry", () => {
    it("renders an inline error card with the failure reason instead of markdown content", () => {
        renderMessage({ message: baseMessage({ error: "upstream 500" }) });
        expect(screen.getByText("Generation failed")).toBeInTheDocument();
        expect(screen.getByText("upstream 500")).toBeInTheDocument();
        expect(screen.queryByText("Hello world")).not.toBeInTheDocument();
    });

    it("shows a Retry button and invokes onRetryFailed with the message id", async () => {
        const user = userEvent.setup();
        const onRetryFailed = vi.fn();
        renderMessage({
            message: baseMessage({ id: "failed-1", error: "timeout" }),
            onRetryFailed,
            isLoading: false,
        });
        await user.click(screen.getByRole("button", { name: /Retry/ }));
        expect(onRetryFailed).toHaveBeenCalledWith("failed-1");
    });

    it("hides the Retry button while a generation is in-flight (isLoading)", () => {
        renderMessage({
            message: baseMessage({ error: "timeout" }),
            onRetryFailed: vi.fn(),
            isLoading: true,
        });
        expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    });

    it("hides the Retry button when no onRetryFailed handler was passed", () => {
        renderMessage({ message: baseMessage({ error: "timeout" }) });
        expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    });
});

describe("ChatMessage — copy action", () => {
    it("copies the plain-text content and flips the icon to a checkmark on success", async () => {
        const user = userEvent.setup();
        const { container } = renderMessage({ message: baseMessage({ content: "copy me" }) });

        const copyButton = screen.getByTitle("Copy");
        expect(container.querySelector('button[title="Copy"] svg.lucide-copy')).toBeInTheDocument();

        await user.click(copyButton);

        expect(copyToClipboardMock).toHaveBeenCalledWith("copy me");
        await waitFor(() =>
            expect(container.querySelector('button[title="Copy"] svg.lucide-check')).toBeInTheDocument()
        );
    });

    it("reverts to the copy icon after the 2s toast window using fake timers", async () => {
        // `userEvent.click` internally awaits real-time delays and hangs
        // forever once fake timers are active (a pre-existing gotcha also
        // worked around in tests/dom/admin/logs-json-tools.test.tsx), so we
        // use `fireEvent` + `act` here instead.
        vi.useFakeTimers();
        try {
            const { container } = renderMessage({ message: baseMessage({ content: "copy me" }) });

            await act(async () => {
                fireEvent.click(screen.getByTitle("Copy"));
            });
            expect(container.querySelector('button[title="Copy"] svg.lucide-check')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(2000);
            });
            expect(container.querySelector('button[title="Copy"] svg.lucide-copy')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not flip the icon when the clipboard write fails", async () => {
        copyToClipboardMock.mockResolvedValue(false);
        const user = userEvent.setup();
        const { container } = renderMessage({ message: baseMessage({ content: "copy me" }) });

        await user.click(screen.getByTitle("Copy"));
        expect(copyToClipboardMock).toHaveBeenCalled();
        expect(container.querySelector('button[title="Copy"] svg.lucide-copy')).toBeInTheDocument();
    });
});

describe("ChatMessage — rating", () => {
    it("rates a message 'up' and highlights the thumbs-up button", async () => {
        const user = userEvent.setup();
        renderMessage({ message: baseMessage({ id: "m-rate", generation_id: "gen-1" }) });

        const up = screen.getByTitle("Good response");
        await user.click(up);

        expect(rateMock).toHaveBeenCalledWith("m-rate", "up");
        await waitFor(() => expect(up.className).toContain("text-green-500"));
    });

    it("toggles an existing rating back to 'none' when clicked again", async () => {
        const user = userEvent.setup();
        renderMessage({
            message: baseMessage({ id: "m-rate", generation_id: "gen-1", rating: "up" }),
        });
        const up = screen.getByTitle("Good response");
        expect(up.className).toContain("text-green-500");

        await user.click(up);
        expect(rateMock).toHaveBeenCalledWith("m-rate", "none");
    });

    it("switches from 'up' to 'down' in one click", async () => {
        const user = userEvent.setup();
        renderMessage({
            message: baseMessage({ id: "m-rate", generation_id: "gen-1", rating: "up" }),
        });
        await user.click(screen.getByTitle("Bad response"));
        expect(rateMock).toHaveBeenCalledWith("m-rate", "down");
    });

    it("shows an error toast and leaves the rating unset when the request fails", async () => {
        rateMock.mockRejectedValue(new Error("network down"));
        const user = userEvent.setup();
        renderMessage({ message: baseMessage({ id: "m-rate", generation_id: "gen-1" }) });

        await user.click(screen.getByTitle("Good response"));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to rate message"));
        expect(screen.getByTitle("Good response").className).not.toContain("text-green-500");
    });

    it("does not render rating buttons before a generation_id exists (still streaming)", () => {
        renderMessage({ message: baseMessage({ generation_id: undefined }) });
        expect(screen.queryByTitle("Good response")).not.toBeInTheDocument();
        expect(screen.queryByTitle("Bad response")).not.toBeInTheDocument();
    });

    it("does not render rating buttons for user messages", () => {
        renderMessage({ message: baseMessage({ role: "user", generation_id: "gen-1" }) });
        expect(screen.queryByTitle("Good response")).not.toBeInTheDocument();
    });
});

describe("ChatMessage — regenerate / view generation", () => {
    it("shows Regenerate only for the last assistant message once settled and idle", () => {
        renderMessage({
            message: baseMessage({ generation_id: "gen-1" }),
            isLastAssistant: true,
            onRegenerate: vi.fn(),
            isLoading: false,
        });
        expect(screen.getByTitle("Regenerate response")).toBeInTheDocument();
    });

    it("hides Regenerate when it isn't the last assistant message", () => {
        renderMessage({
            message: baseMessage({ generation_id: "gen-1" }),
            isLastAssistant: false,
            isLoading: false,
            onRegenerate: vi.fn(),
        });
        expect(screen.queryByTitle("Regenerate response")).not.toBeInTheDocument();
    });

    it("hides Regenerate while still loading", () => {
        renderMessage({
            message: baseMessage({ generation_id: "gen-1" }),
            isLastAssistant: true,
            isLoading: true,
            onRegenerate: vi.fn(),
        });
        expect(screen.queryByTitle("Regenerate response")).not.toBeInTheDocument();
    });

    it("hides Regenerate when the message has no generation_id yet", () => {
        renderMessage({
            message: baseMessage({ generation_id: undefined }),
            isLastAssistant: true,
            isLoading: false,
            onRegenerate: vi.fn(),
        });
        expect(screen.queryByTitle("Regenerate response")).not.toBeInTheDocument();
    });

    it("hides Regenerate when no onRegenerate handler is passed", () => {
        renderMessage({
            message: baseMessage({ generation_id: "gen-1" }),
            isLastAssistant: true,
            isLoading: false,
        });
        expect(screen.queryByTitle("Regenerate response")).not.toBeInTheDocument();
    });

    it("invokes onRegenerate when clicked", async () => {
        const user = userEvent.setup();
        const onRegenerate = vi.fn();
        renderMessage({
            message: baseMessage({ generation_id: "gen-1" }),
            isLastAssistant: true,
            onRegenerate,
            isLoading: false,
        });
        await user.click(screen.getByTitle("Regenerate response"));
        expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it("shows a 'View generation details' button and invokes the callback with the generation id", async () => {
        const user = userEvent.setup();
        const onViewGeneration = vi.fn();
        renderMessage({ message: baseMessage({ generation_id: "gen-42" }), onViewGeneration });

        await user.click(screen.getByTitle("View generation details"));
        expect(onViewGeneration).toHaveBeenCalledWith("gen-42");
    });

    it("hides 'View generation details' without a generation_id", () => {
        renderMessage({ message: baseMessage({ generation_id: undefined }), onViewGeneration: vi.fn() });
        expect(screen.queryByTitle("View generation details")).not.toBeInTheDocument();
    });
});

describe("ChatMessage — attachments", () => {
    it("renders image and file attachment parts above the text body", () => {
        renderMessage({
            message: baseMessage({
                role: "user",
                content: [
                    { type: "text", text: "check these out" },
                    { type: "image_url", image_url: { url: "data:image/png;base64,aaaa" } },
                    { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,bbbb", mime_type: "application/pdf" } },
                ],
            }),
        });
        expect(screen.getByText("check these out")).toBeInTheDocument();
        expect(screen.getByAltText("attachment")).toHaveAttribute("src", "data:image/png;base64,aaaa");
        expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
});

describe("ChatMessage — tool calls", () => {
    it("folds inline tool_call content parts into the ToolCallsList", () => {
        renderMessage({
            message: baseMessage({
                content: [
                    { type: "text", text: "let me check" },
                    { type: "tool_call", tool_call: { id: "call-1", name: "search", arguments: "{}", source: "github" } },
                ],
            }),
        });
        expect(screen.getByText("1 tool call")).toBeInTheDocument();
        expect(screen.getByText(/search/)).toBeInTheDocument();
    });

    it("prefers the pre-assembled message.tool_calls array (server-hydrated) over content parts", () => {
        renderMessage({
            message: baseMessage({
                content: "",
                tool_calls: [
                    { id: "call-2", name: "list_files", arguments: "{}", result: { content: "a.txt", is_error: false } },
                    { id: "call-3", name: "read_file", arguments: "{}", result: { content: "boom", is_error: true } },
                ],
            }),
        });
        expect(screen.getByText("2 tool calls")).toBeInTheDocument();
    });

    it("renders no tool call section when there are none", () => {
        renderMessage({ message: baseMessage({ content: "just text" }) });
        expect(screen.queryByText(/tool call/)).not.toBeInTheDocument();
    });
});

describe("ChatMessage — sibling card mode", () => {
    it("marks the selected sibling as Active when onSelect is wired (head of conversation)", () => {
        renderMessage({
            message: baseMessage({ parent_id: "p1" }),
            isSibling: true,
            siblingCount: 2,
            isSelected: true,
            onSelect: vi.fn(),
        });
        expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("marks the selected sibling as read-only Context when onSelect is absent (mid-conversation)", () => {
        renderMessage({
            message: baseMessage({ parent_id: "p1" }),
            isSibling: true,
            siblingCount: 2,
            isSelected: true,
        });
        expect(screen.getByText("Context")).toBeInTheDocument();
        expect(screen.queryByText("Active")).not.toBeInTheDocument();
    });

    it("invokes onSelect when a selectable sibling card is clicked", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const { container } = renderMessage({
            message: baseMessage({ parent_id: "p1", content: "sibling body" }),
            isSibling: true,
            siblingCount: 2,
            isSelected: false,
            onSelect,
        });
        // Click the outer card (not a nested interactive control).
        await user.click(container.querySelector(".group.relative")!);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

describe("ChatMessage — mobile tap-to-reveal actions", () => {
    it("reveals the actions bar on tap and keeps it visible while a rating is set", async () => {
        const user = userEvent.setup();
        const { container } = renderMessage({ message: baseMessage({ content: "tap me" }) });

        const actionsBar = container.querySelector(".absolute.bottom-0.translate-y-1\\/2") as HTMLElement;
        expect(actionsBar.className).toContain("opacity-0");

        await user.click(screen.getByText("tap me"));
        expect(actionsBar.className).toContain("opacity-100");
    });

    it("does not toggle the actions bar when the tap originates from a button", async () => {
        const user = userEvent.setup();
        const { container } = renderMessage({ message: baseMessage({ content: "tap me" }) });
        const actionsBar = container.querySelector(".absolute.bottom-0.translate-y-1\\/2") as HTMLElement;

        await user.click(screen.getByTitle("Copy"));
        expect(actionsBar.className).toContain("opacity-0");
    });
});
