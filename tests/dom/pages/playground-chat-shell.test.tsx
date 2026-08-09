import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { renderWithClient } from "./_helpers";

const useSearchParamsMock = vi.fn();
const usePathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
    useSearchParams: () => useSearchParamsMock(),
    usePathname: () => usePathnameMock(),
}));

vi.mock("@/components/playground/chat-flow", () => ({
    ChatFlow: ({ conversationId }: { conversationId: string }) => (
        <div data-testid="chat-flow" data-conv-id={conversationId} />
    ),
}));
vi.mock("@/components/playground/conversation-sidebar", () => ({
    ConversationSidebar: () => <div data-testid="conversation-sidebar" />,
}));
vi.mock("@/components/playground/modalities", () => ({
    modalityFromPath: (...a: unknown[]) => modalityFromPathMock(...a),
    MODALITIES: [],
}));
const setLastPathMock = vi.fn();
const setModalityPathMock = vi.fn();
const modalityFromPathMock = vi.fn();
vi.mock("@/lib/stores/modality-store", () => ({
    useModalityStore: (selector: (s: unknown) => unknown) => selector({
        lastPath: null,
        setLastPath: setLastPathMock,
        setModalityPath: setModalityPathMock,
    }),
    entryPath: () => "/playground/chat",
}));

import ChatPlaygroundPage from "@/app/(dashboard)/playground/chat/page";
import PlaygroundLayout from "@/app/(dashboard)/playground/layout";
import { conversations } from "@/lib/api/conversations";

describe("ChatPlaygroundPage", () => {
    beforeEach(() => {
        useSearchParamsMock.mockReset();
    });

    it("draft mode (no ?c=): mints a client-only UUID and pre-seeds the empty messages cache", () => {
        useSearchParamsMock.mockReturnValue(new URLSearchParams());
        const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-1111-1111-111111111111");

        const { queryClient } = renderWithClient(<ChatPlaygroundPage />);

        expect(screen.getByTestId("conversation-sidebar")).toBeInTheDocument();
        const chatFlow = screen.getByTestId("chat-flow");
        expect(chatFlow).toHaveAttribute("data-conv-id", "11111111-1111-1111-1111-111111111111");

        const cached = queryClient.getQueryData(
            conversations.messagesCacheKey("11111111-1111-1111-1111-111111111111", 20),
        );
        expect(cached).toEqual([]);

        uuidSpy.mockRestore();
    });

    it("real conversation mode (?c=<id>): uses the URL id verbatim and does not pre-seed cache", () => {
        useSearchParamsMock.mockReturnValue(new URLSearchParams("c=conv-42"));
        const { queryClient } = renderWithClient(<ChatPlaygroundPage />);

        expect(screen.getByTestId("chat-flow")).toHaveAttribute("data-conv-id", "conv-42");
        const cached = queryClient.getQueryData(conversations.messagesCacheKey("conv-42", 20));
        expect(cached).toBeUndefined();
    });

    it("re-mints a fresh draft id when transitioning from a real conversation to no ?c=", () => {
        const uuidSpy = vi.spyOn(crypto, "randomUUID")
            .mockReturnValueOnce("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
            .mockReturnValueOnce("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

        useSearchParamsMock.mockReturnValue(new URLSearchParams("c=conv-1"));
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { rerender } = render(
            <QueryClientProvider client={queryClient}>
                <ChatPlaygroundPage />
            </QueryClientProvider>,
        );
        expect(screen.getByTestId("chat-flow")).toHaveAttribute("data-conv-id", "conv-1");

        useSearchParamsMock.mockReturnValue(new URLSearchParams());
        rerender(
            <QueryClientProvider client={queryClient}>
                <ChatPlaygroundPage />
            </QueryClientProvider>,
        );
        expect(screen.getByTestId("chat-flow")).toHaveAttribute(
            "data-conv-id",
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        );

        uuidSpy.mockRestore();
    });
});

describe("PlaygroundLayout", () => {
    beforeEach(() => {
        setLastPathMock.mockClear();
        setModalityPathMock.mockClear();
        modalityFromPathMock.mockReset();
        modalityFromPathMock.mockReturnValue(undefined);
    });

    afterEach(() => cleanup());

    it("renders children and only touches the modality store for /playground/* paths", () => {
        usePathnameMock.mockReturnValue("/playground/chat");
        useSearchParamsMock.mockReturnValue(new URLSearchParams());
        render(
            <PlaygroundLayout>
                <p>hub content</p>
            </PlaygroundLayout>,
        );
        expect(screen.getByText("hub content")).toBeInTheDocument();
        expect(setLastPathMock).toHaveBeenCalledWith("/playground/chat");
    });

    it("no-ops for a non-/playground pathname", () => {
        usePathnameMock.mockReturnValue("/logs");
        useSearchParamsMock.mockReturnValue(new URLSearchParams());
        render(
            <PlaygroundLayout>
                <p>other content</p>
            </PlaygroundLayout>,
        );
        expect(screen.getByText("other content")).toBeInTheDocument();
        expect(setLastPathMock).not.toHaveBeenCalled();
        expect(setModalityPathMock).not.toHaveBeenCalled();
    });

    it("no-ops when the pathname is not yet available (null)", () => {
        usePathnameMock.mockReturnValue(null);
        useSearchParamsMock.mockReturnValue(new URLSearchParams());
        render(
            <PlaygroundLayout>
                <p>loading content</p>
            </PlaygroundLayout>,
        );
        expect(screen.getByText("loading content")).toBeInTheDocument();
        expect(setLastPathMock).not.toHaveBeenCalled();
    });

    it("falls back to an empty query string when search params are unavailable", () => {
        usePathnameMock.mockReturnValue("/playground/chat");
        useSearchParamsMock.mockReturnValue(null);
        render(
            <PlaygroundLayout>
                <p>hub content</p>
            </PlaygroundLayout>,
        );
        expect(setLastPathMock).toHaveBeenCalledWith("/playground/chat");
    });

    it("appends the query string to the recorded path when search params are present", () => {
        usePathnameMock.mockReturnValue("/playground/chat");
        useSearchParamsMock.mockReturnValue(new URLSearchParams("c=conv-1"));
        render(
            <PlaygroundLayout>
                <p>hub content</p>
            </PlaygroundLayout>,
        );
        expect(setLastPathMock).toHaveBeenCalledWith("/playground/chat?c=conv-1");
    });

    it("also records the per-modality last path when the pathname resolves to a known modality", () => {
        usePathnameMock.mockReturnValue("/playground/chat");
        useSearchParamsMock.mockReturnValue(new URLSearchParams());
        modalityFromPathMock.mockReturnValue({ id: "chat" });
        render(
            <PlaygroundLayout>
                <p>hub content</p>
            </PlaygroundLayout>,
        );
        expect(setModalityPathMock).toHaveBeenCalledWith("chat", "/playground/chat");
    });
});
