// Tests for components/playground/conversation-sidebar.tsx.
//
// Renders the REAL ConversationItem (_parts/conversation-item.tsx, owned
// by another agent) — only next/link is shimmed (mirrors the convention
// in tests/dom/playground/shared/conversation-item.test.tsx). The data
// layer (conversations.useInfinite/useDelete/useUpdate) and next/navigation
// are mocked; conversations.keys / messagesCacheKey / listMessages stay
// real (pure helpers) via a partial mock.
import * as React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient, resetPlaygroundStores } from "./_render";
import { makeMutation, makeInfiniteQuery } from "./_mocks";
import { makeConversation, paginated } from "./_fixtures";
import type { ConversationDTO } from "@/lib/schemas/conversation";

// ---- next/navigation: mutable hoisted state so each test controls the
// active conversation id + captures router calls. ----
const nav = vi.hoisted(() => ({
    activeId: null as string | null,
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
    useSearchParams: () => new URLSearchParams(nav.activeId ? `c=${nav.activeId}` : ""),
    usePathname: () => "/playground/chat",
}));

// ---- next/link: real Link needs an app-router context we don't provide;
// swap for a plain <a>, same as the sibling conversation-item test file. ----
vi.mock("next/link", () => ({
    default: ({ href, children, prefetch: _prefetch, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

// Partial mock: keep keys/messagesCacheKey/listMessages/updateTitle real
// (pure helpers, no network at import time), override only the 3 hooks
// the component calls.
vi.mock("@/lib/api/conversations", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api/conversations")>();
    return {
        ...actual,
        conversations: {
            ...actual.conversations,
            useInfinite: vi.fn(),
            useDelete: vi.fn(),
            useUpdate: vi.fn(),
        },
    };
});

import { toast } from "sonner";
import { conversations } from "@/lib/api/conversations";
import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { useModalityStore } from "@/lib/stores/modality-store";
import { ConversationSidebar } from "@/components/playground/conversation-sidebar";

// ---- local IntersectionObserver double (the global stub in
// tests/setup/dom.ts has no way to trigger callbacks externally). ----
let ioCallback: IntersectionObserverCallback | null = null;
const ioObserve = vi.fn();
const ioDisconnect = vi.fn();
class FakeIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
        ioCallback = cb;
    }
    observe(target: Element) {
        ioObserve(target);
    }
    unobserve() {}
    disconnect() {
        ioDisconnect();
    }
    takeRecords() {
        return [];
    }
}
const OriginalIntersectionObserver = globalThis.IntersectionObserver;

beforeAll(() => {
    globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});
afterAll(() => {
    globalThis.IntersectionObserver = OriginalIntersectionObserver;
});

function setConvList(
    items: ConversationDTO[],
    opts?: { hasNextPage?: boolean; isFetchingNextPage?: boolean; isLoading?: boolean }
) {
    vi.mocked(conversations.useInfinite).mockReturnValue(
        makeInfiniteQuery({
            data: { pages: [paginated(items, { total: items.length })], pageParams: [1] },
            hasNextPage: opts?.hasNextPage ?? false,
            isFetchingNextPage: opts?.isFetchingNextPage ?? false,
            isLoading: opts?.isLoading ?? false,
        })
    );
}

// jsdom's real Location throws "Not implemented: navigation" and never
// actually updates `.search`, so swap in a plain mutable stub we can both
// assert against (`.assign`) and drive (`.search`), mirroring the pattern
// in tests/dom/api/client.test.ts. Object.defineProperty (rather than a
// direct assignment) avoids a TS2322 mismatch against Location's real type.
const originalLocation = window.location;
let mockLocation: { assign: ReturnType<typeof vi.fn>; search: string };
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetPlaygroundStores();
    nav.activeId = null;
    ioCallback = null;
    setConvList([]);
    vi.mocked(conversations.useDelete).mockReturnValue(makeMutation());
    vi.mocked(conversations.useUpdate).mockReturnValue(makeMutation());
    mockLocation = { assign: vi.fn(), search: "" };
    // @ts-expect-error - intentionally replacing the read-only jsdom Location.
    delete window.location;
    Object.defineProperty(window, "location", { configurable: true, value: mockLocation });
    assignSpy = mockLocation.assign;
});

afterEach(() => {
    resetPlaygroundStores();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Locates a conversation row's <a> element by its title text. */
function row(title: string): HTMLElement {
    return screen.getByText(title).closest("a") as HTMLElement;
}

/** The row's dropdown-menu trigger — the sole nested <button>. */
function rowMenuButton(title: string): HTMLElement {
    return row(title).querySelector("button") as HTMLElement;
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(rowMenuButton(title));
}

function newChatButton(): HTMLElement {
    return (document.querySelector("svg.lucide-square-pen") as Element).closest("button") as HTMLElement;
}

function collapseButton(): HTMLElement | null {
    const icon = document.querySelector("svg.lucide-panel-left-close");
    return icon ? (icon.closest("button") as HTMLElement) : null;
}

function expandButton(): HTMLElement | null {
    const icon = document.querySelector("svg.lucide-panel-left");
    return icon ? (icon.closest("button") as HTMLElement) : null;
}

function searchInput(): HTMLInputElement {
    return screen.getByPlaceholderText("Search chats") as HTMLInputElement;
}

// ---------------------------------------------------------------------------

describe("ConversationSidebar — loading / empty states", () => {
    it("shows the list skeleton while the first page is loading", () => {
        setConvList([], { isLoading: true });
        renderWithClient(<ConversationSidebar />);
        expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
        expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();
    });

    it("shows an empty state with no search term", () => {
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        expect(screen.getByText("No conversations yet")).toBeInTheDocument();
        expect(screen.getByText("Start a new chat to see it here")).toBeInTheDocument();
    });

    it("shows a 'no matches' empty state once a search term is debounced in", async () => {
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        fireEvent.change(searchInput(), { target: { value: "zzz-no-match" } });
        await waitFor(
            () => expect(vi.mocked(conversations.useInfinite)).toHaveBeenLastCalledWith(
                expect.objectContaining({ keyword: "zzz-no-match" })
            ),
            { timeout: 2000 }
        );
        // The mocked hook doesn't actually filter — re-render with an
        // explicitly empty list to reflect what the (debounced) keyword
        // would produce server-side.
        setConvList([]);
        expect(await screen.findByText("No matches")).toBeInTheDocument();
        expect(screen.getByText("Try a different search term")).toBeInTheDocument();
    });
});

describe("ConversationSidebar — search input", () => {
    it("shows/hides the clear (X) button and clears the query on click", () => {
        setConvList([makeConversation({ id: "c1", title: "Conv A" })]);
        renderWithClient(<ConversationSidebar />);
        expect(document.querySelector("svg.lucide-x")).not.toBeInTheDocument();

        fireEvent.change(searchInput(), { target: { value: "abc" } });
        expect(searchInput()).toHaveValue("abc");
        const clearBtn = (document.querySelector("svg.lucide-x") as Element).closest("button") as HTMLElement;
        fireEvent.click(clearBtn);
        expect(searchInput()).toHaveValue("");
        expect(document.querySelector("svg.lucide-x")).not.toBeInTheDocument();
    });

    it("passes the debounced, trimmed keyword through to conversations.useInfinite", async () => {
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        fireEvent.change(searchInput(), { target: { value: "  hello  " } });
        await waitFor(
            () => expect(vi.mocked(conversations.useInfinite)).toHaveBeenLastCalledWith(
                expect.objectContaining({ keyword: "hello" })
            ),
            { timeout: 2000 }
        );
    });
});

describe("ConversationSidebar — date grouping", () => {
    function startOfDay(d: Date): number {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x.getTime();
    }

    it("buckets conversations into Today / Yesterday / Previous 7 / Previous 30 / month-named groups, in order", () => {
        const now = new Date();
        const today = startOfDay(now);
        const yesterday = today - 24 * 60 * 60 * 1000;
        const last7 = today - 7 * 24 * 60 * 60 * 1000;
        const last30 = today - 30 * 24 * 60 * 60 * 1000;
        const olderTs = last30 - 5 * 24 * 60 * 60 * 1000;
        const olderLabel = new Date(olderTs).toLocaleDateString(undefined, { year: "numeric", month: "long" });

        const mk = (id: string, title: string, ts: number) =>
            makeConversation({ id, title, updated_at: new Date(ts).toISOString(), created_at: new Date(ts).toISOString() });

        setConvList([
            mk("c-today", "Conv Today", today + 1000),
            mk("c-yesterday", "Conv Yesterday", yesterday + 1000),
            mk("c-last7", "Conv Last7", last7 + 1000),
            mk("c-last30", "Conv Last30", last30 + 1000),
            mk("c-older", "Conv Older", olderTs),
        ]);
        renderWithClient(<ConversationSidebar />);

        const labels = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", olderLabel];
        for (const label of labels) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
        // Order: group headers must appear in the same order as `labels`.
        const positions = labels.map((l) => screen.getByText(l).compareDocumentPosition);
        expect(positions.length).toBe(labels.length);
        const headerEls = labels.map((l) => screen.getByText(l));
        for (let i = 0; i < headerEls.length - 1; i++) {
            // DOCUMENT_POSITION_FOLLOWING (4) means headerEls[i+1] comes after headerEls[i].
            expect(headerEls[i].compareDocumentPosition(headerEls[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }

        // Spot-check nesting: each title lives under its own group only.
        const todayGroup = screen.getByText("Today").parentElement as HTMLElement;
        expect(within(todayGroup).getByText("Conv Today")).toBeInTheDocument();
        expect(within(todayGroup).queryByText("Conv Yesterday")).not.toBeInTheDocument();

        const olderGroup = screen.getByText(olderLabel).parentElement as HTMLElement;
        expect(within(olderGroup).getByText("Conv Older")).toBeInTheDocument();
    });

    it("normalizes updated_at strings without a timezone suffix, and honors explicit offsets, without crashing", () => {
        setConvList([
            makeConversation({
                id: "c-tz1",
                title: "No zone",
                updated_at: "2024-01-01T10:00:00",
                created_at: "2024-01-01T10:00:00.000Z",
            }),
            makeConversation({
                id: "c-tz2",
                title: "With offset",
                updated_at: "2024-01-01T10:00:00+08:00",
                created_at: "2024-01-01T10:00:00.000Z",
            }),
        ]);
        renderWithClient(<ConversationSidebar />);
        expect(screen.getByText("No zone")).toBeInTheDocument();
        expect(screen.getByText("With offset")).toBeInTheDocument();
    });
});

describe("ConversationSidebar — new chat", () => {
    it("disables the inline new-chat button while there is no active conversation", () => {
        nav.activeId = null;
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        expect(newChatButton()).toBeDisabled();
    });

    it("navigates to the bare /playground/chat path when there is an active conversation", async () => {
        nav.activeId = "conv-9";
        setConvList([]);
        const user = userEvent.setup();
        renderWithClient(<ConversationSidebar />);
        await user.click(newChatButton());
        expect(nav.push).toHaveBeenCalledWith("/playground/chat");
    });

    it("uses a cache-busting href from the always-enabled collapsed-rail button when there's no active conversation", () => {
        usePlaygroundStore.getState().setHistorySidebarOpen(false);
        nav.activeId = null;
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        fireEvent.click(newChatButton());
        expect(nav.push).toHaveBeenCalledTimes(1);
        expect(nav.push.mock.calls[0][0]).toMatch(/^\/playground\/chat\?_=\d+$/);
    });

    it("falls back to a hard navigation via window.location.assign if the URL still carries ?c= after 300ms (soft-nav stalled)", () => {
        vi.useFakeTimers();
        // The 300ms fallback reads window.location.search (the mocked
        // router.push doesn't touch it) — simulate a stalled soft-nav by
        // leaving the stub URL at "?c=...".
        mockLocation.search = "?c=conv-9";
        try {
            nav.activeId = "conv-9";
            setConvList([]);
            renderWithClient(<ConversationSidebar />);
            fireEvent.click(newChatButton());
            act(() => {
                vi.advanceTimersByTime(300);
            });
            expect(assignSpy).toHaveBeenCalledWith("/playground/chat");
        } finally {
            vi.useRealTimers();
        }
    });

    it("does NOT fall back when the URL no longer carries ?c= (soft-nav succeeded)", () => {
        vi.useFakeTimers();
        mockLocation.search = "?c=conv-9";
        try {
            nav.activeId = "conv-9";
            setConvList([]);
            renderWithClient(<ConversationSidebar />);
            fireEvent.click(newChatButton());
            // Simulate the soft-nav having landed before the fallback timer fires.
            mockLocation.search = "";
            act(() => {
                vi.advanceTimersByTime(300);
            });
            expect(assignSpy).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("ConversationSidebar — collapse / expand toggle", () => {
    it("collapses the desktop sidebar and shows the rail's expand button", async () => {
        const user = userEvent.setup();
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        expect(collapseButton()).not.toBeNull();
        await user.click(collapseButton() as HTMLElement);
        expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(false);
        expect(expandButton()).not.toBeNull();
    });

    it("expands again from the collapsed rail", async () => {
        usePlaygroundStore.getState().setHistorySidebarOpen(false);
        const user = userEvent.setup();
        setConvList([]);
        renderWithClient(<ConversationSidebar />);
        await user.click(expandButton() as HTMLElement);
        expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(true);
    });
});

describe("ConversationSidebar — rename flow", () => {
    it("commits a rename through conversations.useUpdate and reflects onError with a toast", async () => {
        const user = userEvent.setup();
        const conv = makeConversation({ id: "c1", title: "Old title" });
        setConvList([conv]);
        renderWithClient(<ConversationSidebar />);

        await openRowMenu(user, "Old title");
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }));
        const input = screen.getByDisplayValue("Old title");
        await user.clear(input);
        await user.type(input, "New title{Enter}");

        const updateMut = vi.mocked(conversations.useUpdate).mock.results.at(-1)!.value;
        expect(updateMut.mutate).toHaveBeenCalledWith({ id: "c1", data: { title: "New title" } });

        // Simulate the mutation failing.
        const opts = vi.mocked(conversations.useUpdate).mock.calls.at(-1)![0];
        opts?.onError?.(new Error("boom"), { id: "c1", data: { title: "New title" } }, undefined, undefined as any);
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to rename conversation");
    });
});

describe("ConversationSidebar — delete flow", () => {
    it("opens a confirm dialog naming the conversation, and does nothing when cancelled", async () => {
        const user = userEvent.setup();
        const conv = makeConversation({ id: "c1", title: "Delete me" });
        setConvList([conv]);
        const deleteMut = makeMutation();
        vi.mocked(conversations.useDelete).mockReturnValue(deleteMut);
        renderWithClient(<ConversationSidebar />);

        await openRowMenu(user, "Delete me");
        await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
        expect(await screen.findByText(/Delete me.*will be removed/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(deleteMut.mutate).not.toHaveBeenCalled();
        expect(screen.queryByText(/will be removed/)).not.toBeInTheDocument();
    });

    it("confirming calls mutate(id); onSuccess for a non-active conversation removes settings/cache and toasts, without navigating", async () => {
        const user = userEvent.setup();
        nav.activeId = "some-other-conv";
        const conv = makeConversation({ id: "c1", title: "Delete me" });
        setConvList([conv]);
        const deleteMut = makeMutation();
        vi.mocked(conversations.useDelete).mockReturnValue(deleteMut);
        usePlaygroundStore.getState().updateSettings("c1", { modelIds: ["gpt-4o"] });
        renderWithClient(<ConversationSidebar />);

        await openRowMenu(user, "Delete me");
        await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
        await user.click(await screen.findByRole("button", { name: "Delete" }));
        expect(deleteMut.mutate).toHaveBeenCalledWith("c1");

        const opts = vi.mocked(conversations.useDelete).mock.calls.at(-1)![0];
        act(() => {
            opts?.onSuccess?.(null, "c1", undefined, undefined as any);
        });
        expect(usePlaygroundStore.getState().getSettings("c1")).toEqual({});
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Conversation deleted");
        expect(assignSpy).not.toHaveBeenCalled();
    });

    it("onSuccess for the ACTIVE conversation hard-navigates to a fresh draft", async () => {
        const user = userEvent.setup();
        nav.activeId = "c1";
        const conv = makeConversation({ id: "c1", title: "Delete me" });
        setConvList([conv]);
        const deleteMut = makeMutation();
        vi.mocked(conversations.useDelete).mockReturnValue(deleteMut);
        renderWithClient(<ConversationSidebar />);

        await openRowMenu(user, "Delete me");
        await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
        await user.click(await screen.findByRole("button", { name: "Delete" }));

        const opts = vi.mocked(conversations.useDelete).mock.calls.at(-1)![0];
        act(() => {
            opts?.onSuccess?.(null, "c1", undefined, undefined as any);
        });
        expect(assignSpy).toHaveBeenCalledTimes(1);
        expect(assignSpy.mock.calls[0][0]).toMatch(/^\/playground\/chat\?fresh=\d+$/);
    });

    it("onError shows a failure toast", async () => {
        setConvList([]);
        vi.mocked(conversations.useDelete).mockReturnValue(makeMutation());
        renderWithClient(<ConversationSidebar />);
        const opts = vi.mocked(conversations.useDelete).mock.calls.at(-1)![0];
        opts?.onError?.(new Error("boom"), "c1", undefined, undefined as any);
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to delete conversation");
    });
});

describe("ConversationSidebar — hover prefetch", () => {
    it("prefetches a conversation's messages once per hover, deduping repeat hovers", async () => {
        const user = userEvent.setup();
        const conv = makeConversation({ id: "c1", title: "Conv A" });
        setConvList([conv]);
        const { queryClient } = renderWithClient(<ConversationSidebar />);
        const prefetchSpy = vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);

        await user.hover(row("Conv A"));
        expect(prefetchSpy).toHaveBeenCalledTimes(1);
        expect(prefetchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: conversations.messagesCacheKey("c1", 20) })
        );

        await user.unhover(row("Conv A"));
        await user.hover(row("Conv A"));
        expect(prefetchSpy).toHaveBeenCalledTimes(1);
    });
});

describe("ConversationSidebar — infinite scroll (IntersectionObserver)", () => {
    it.each([
        [true, false, true],
        [false, false, false],
        [true, true, false],
    ] as const)(
        "hasNextPage=%s isFetchingNextPage=%s -> fetchNextPage called=%s",
        (hasNextPage, isFetchingNextPage, expectCalled) => {
            const fetchNextPage = vi.fn();
            vi.mocked(conversations.useInfinite).mockReturnValue(
                makeInfiniteQuery({
                    data: { pages: [paginated([makeConversation({ id: "c1", title: "Conv A" })])], pageParams: [1] },
                    hasNextPage,
                    isFetchingNextPage,
                    fetchNextPage,
                })
            );
            renderWithClient(<ConversationSidebar />);
            act(() => {
                ioCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
            });
            if (expectCalled) {
                expect(fetchNextPage).toHaveBeenCalled();
            } else {
                expect(fetchNextPage).not.toHaveBeenCalled();
            }
        }
    );

    it("shows a spinner while fetching the next page", () => {
        setConvList([makeConversation({ id: "c1", title: "Conv A" })], { isFetchingNextPage: true });
        renderWithClient(<ConversationSidebar />);
        expect(document.querySelector("svg.lucide-loader-circle")).toBeInTheDocument();
    });
});

describe("ConversationSidebar — dedupes duplicate ids across pages", () => {
    it("renders only one row per conversation id even when a page overlaps with the previous one", () => {
        const c1 = makeConversation({ id: "c1", title: "Conv One" });
        const c2 = makeConversation({ id: "c2", title: "Conv Two" });
        const c2Dup = makeConversation({ id: "c2", title: "Conv Two" });
        const c3 = makeConversation({ id: "c3", title: "Conv Three" });
        vi.mocked(conversations.useInfinite).mockReturnValue(
            makeInfiniteQuery({
                data: {
                    pages: [paginated([c1, c2Dup]), paginated([c2, c3])],
                    pageParams: [1, 2],
                },
            })
        );
        renderWithClient(<ConversationSidebar />);
        expect(screen.getAllByText("Conv Two")).toHaveLength(1);
        expect(screen.getByText("Conv One")).toBeInTheDocument();
        expect(screen.getByText("Conv Three")).toBeInTheDocument();
    });
});

describe("ConversationSidebar — mobile Sheet", () => {
    it("renders the conversation list inside the mobile sheet, and picking a row closes it", () => {
        // Isolate from the desktop inline body (avoids duplicate-render
        // ambiguity — jsdom doesn't evaluate the `hidden md:flex` media
        // query, so both would otherwise be simultaneously present).
        usePlaygroundStore.getState().setHistorySidebarOpen(false);
        useModalityStore.getState().setChatHistoryOpen(true);
        const conv = makeConversation({ id: "c1", title: "Conv A" });
        setConvList([conv]);
        renderWithClient(<ConversationSidebar />);

        const link = screen.getByText("Conv A").closest("a") as HTMLElement;
        // ConversationItem's own <Link onClick> ALSO schedules a real
        // 300ms soft-nav-fallback setTimeout (independent of the
        // sidebar's own handleNewChat one) whenever the row isn't the
        // active conversation. Use fake timers (and never advance
        // them) so that pending callback can't fire window.location.assign
        // during a LATER test once this one has already torn down its
        // spy — fireEvent (not userEvent) keeps this synchronous.
        vi.useFakeTimers();
        try {
            fireEvent.click(link);
            expect(useModalityStore.getState().chatHistoryOpen).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
