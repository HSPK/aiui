import { test, expect, settled } from "../support/fixtures";
import { composer, sendStreamingPrompt } from "../perf/support/chat";
import { ensureChatModel } from "./chat-model";
import type { Page } from "@playwright/test";

// Depth pass over the chat playground's conversation-management surface:
// multi-turn history, "New chat", sidebar switching, inline rename
// (Save vs. Cancel), and delete. The happy-path single-send flow is already
// covered elsewhere; this file exercises the conversation lifecycle around
// it.
//
// The conversations table is shared across every spec file in this project
// (one throwaway DB per suite run, but many spec files against it), so every
// conversation created here is (a) tagged with a random, unique title and
// (b) deleted again in a `finally` block — never assume an empty sidebar.

function uniqueTitle(label: string): string {
    return `E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The composer clears + the Regenerate action only appears on a completed
 *  (non-loading) assistant reply with a generation id — a reliable signal
 *  that streaming has fully finished, distinct from merely "a request
 *  started". */
async function waitForReplyDone(page: Page): Promise<void> {
    await expect(page.getByTitle("Regenerate response")).toBeVisible({ timeout: 20_000 });
}

function conversationIdFromUrl(page: Page): string | null {
    return new URL(page.url()).searchParams.get("c");
}

/** Scopes a lookup to the message list's scroll viewport (the only
 *  `<ScrollArea>` under components/playground — see chat-flow.tsx),
 *  as opposed to the sidebar. New conversations default their title to
 *  the raw first-message text, so an unscoped `getByText(marker)` can
 *  also match the sidebar row and produce a strict-mode collision or a
 *  false "still on page" result after navigating away. */
function messageArea(page: Page) {
    return page.locator('[data-slot="scroll-area-viewport"]');
}

async function patchTitle(page: Page, id: string, title: string): Promise<void> {
    await page.evaluate(
        async ({ id, title }) => {
            await fetch(`/api/conversations/${id}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
            });
        },
        { id, title },
    );
}

async function deleteConversation(page: Page, id: string | null): Promise<void> {
    if (!id) return;
    await page.evaluate(async (id) => {
        await fetch(`/api/conversations/${id}`, { method: "DELETE", credentials: "include" });
    }, id);
}

/** Type into the sidebar search box and wait for the debounced (220ms —
 *  see conversation-sidebar.tsx) filtered request to actually land before
 *  proceeding. Without this, a row can appear "visible" from the
 *  pre-debounce (unfiltered) render and any click started against it races
 *  the debounced re-render that follows ~220ms later, which can remount the
 *  row (losing any just-opened dropdown state) mid-interaction. */
async function searchSidebar(page: Page, keyword: string): Promise<void> {
    const search = page.getByPlaceholder("Search chats");
    const filteredResponse = page.waitForResponse((res) => {
        const url = new URL(res.url());
        return url.pathname === "/api/conversations" && url.searchParams.get("keyword") === keyword;
    });
    await search.fill(keyword);
    await filteredResponse;
    await expect(page.locator("a").filter({ hasText: keyword })).toBeVisible({ timeout: 10_000 });
}

test.describe("chat playground — conversation lifecycle", () => {
    test("sends multiple turns in one conversation and renders them in order", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);
        await ensureChatModel(page);

        let convId: string | null = null;
        try {
            await sendStreamingPrompt(page, "tokens=6 delay=5 first-turn-marker-a1b2");
            await waitForReplyDone(page);
            convId = conversationIdFromUrl(page);
            expect(convId, "conversation id should appear in the URL after the first send").not.toBeNull();

            await sendStreamingPrompt(page, "tokens=6 delay=5 second-turn-marker-c3d4");
            await waitForReplyDone(page);

            const first = messageArea(page).getByText("first-turn-marker-a1b2");
            const second = messageArea(page).getByText("second-turn-marker-c3d4");
            await expect(first).toBeVisible();
            await expect(second).toBeVisible();

            // Both turns rendered — and in the order they were sent.
            const [firstTop, secondTop] = await Promise.all([
                first.evaluate((el) => el.getBoundingClientRect().top),
                second.evaluate((el) => el.getBoundingClientRect().top),
            ]);
            expect(firstTop, "first turn should render above the second").toBeLessThan(secondTop);
        } finally {
            await deleteConversation(page, convId);
        }
    });

    test("New chat produces a fresh, empty conversation", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);
        await ensureChatModel(page);

        let convId: string | null = null;
        try {
            await sendStreamingPrompt(page, "tokens=5 delay=5 stale-conversation-marker-e5f6");
            await waitForReplyDone(page);
            convId = conversationIdFromUrl(page);
            expect(convId).not.toBeNull();

            await page.getByRole("button", { name: "New chat" }).click();

            // Fresh draft: no `?c=` in the URL, and none of the previous
            // conversation's content in the message area (the old
            // conversation still exists — and its title still shows the
            // marker text in the sidebar — this only asserts the *chat
            // panel* is a clean slate).
            await expect(page).toHaveURL(/\/playground\/chat$/);
            await expect(messageArea(page).getByText("stale-conversation-marker-e5f6")).toHaveCount(0);
            await expect(composer(page)).toHaveValue("");
            await expect(composer(page)).toBeEditable();
        } finally {
            await deleteConversation(page, convId);
        }
    });

    test("switching between conversations in the sidebar loads the right messages", async ({ authedPage: page }) => {
        const titleA = uniqueTitle("Switch-A");
        const titleB = uniqueTitle("Switch-B");
        let idA: string | null = null;
        let idB: string | null = null;

        try {
            await page.goto("/playground/chat");
            await settled(page);
            await ensureChatModel(page);
            await sendStreamingPrompt(page, "tokens=5 delay=5 conversation-a-marker-g7h8");
            await waitForReplyDone(page);
            idA = conversationIdFromUrl(page);
            expect(idA).not.toBeNull();
            await patchTitle(page, idA!, titleA);

            // Fresh draft for the second conversation.
            await page.goto("/playground/chat");
            await settled(page);
            await ensureChatModel(page);
            await sendStreamingPrompt(page, "tokens=5 delay=5 conversation-b-marker-i9j0");
            await waitForReplyDone(page);
            idB = conversationIdFromUrl(page);
            expect(idB).not.toBeNull();
            await patchTitle(page, idB!, titleB);

            // Currently viewing B. Switch to A via the sidebar and confirm
            // A's content loads (not B's).
            await searchSidebar(page, titleA);
            await page.locator("a").filter({ hasText: titleA }).click();
            await expect(page).toHaveURL(new RegExp(`c=${idA}`));
            await expect(page.getByText("conversation-a-marker-g7h8")).toBeVisible();
            await expect(page.getByText("conversation-b-marker-i9j0")).toHaveCount(0);

            // And back to B.
            await searchSidebar(page, titleB);
            await page.locator("a").filter({ hasText: titleB }).click();
            await expect(page).toHaveURL(new RegExp(`c=${idB}`));
            await expect(page.getByText("conversation-b-marker-i9j0")).toBeVisible();
            await expect(page.getByText("conversation-a-marker-g7h8")).toHaveCount(0);
        } finally {
            await deleteConversation(page, idA);
            await deleteConversation(page, idB);
        }
    });

    test("renaming a conversation: Save persists, Cancel (X) discards", async ({ authedPage: page }) => {
        const originalTitle = uniqueTitle("Rename-Original");
        const newTitle = uniqueTitle("Rename-New");
        let convId: string | null = null;

        try {
            await page.goto("/playground/chat");
            await settled(page);
            await ensureChatModel(page);
            await sendStreamingPrompt(page, "tokens=5 delay=5 rename-target-marker-k1l2");
            await waitForReplyDone(page);
            convId = conversationIdFromUrl(page);
            expect(convId).not.toBeNull();
            await patchTitle(page, convId!, originalTitle);

            // Reload so the sidebar list reflects the API-set title.
            await page.reload();
            await settled(page);
            await searchSidebar(page, originalTitle);

            const row = page.locator("a").filter({ hasText: originalTitle });
            await row.getByRole("button").click(); // MoreHorizontal trigger
            await page.getByRole("menuitem", { name: "Rename" }).click();

            const editInput = page.locator("input:focus");
            await expect(editInput).toBeVisible();
            await editInput.fill(newTitle);

            // --- Cancel must DISCARD, not save (this was a real bug). ---
            await page.locator("button.text-red-600").click();
            await expect(page.getByText(originalTitle, { exact: true })).toBeVisible();
            await expect(page.getByText(newTitle, { exact: true })).toHaveCount(0);

            // --- Save must persist the new title. ---
            await row.getByRole("button").click();
            await page.getByRole("menuitem", { name: "Rename" }).click();
            const editInput2 = page.locator("input:focus");
            await expect(editInput2).toBeVisible();
            await editInput2.fill(newTitle);
            await page.locator("button.text-green-600").click();
            // The rename invalidates the list query, which refetches under
            // the search box's CURRENT (still `originalTitle`) keyword —
            // re-searching for the new title both waits out that refetch
            // and confirms the rename landed server-side.
            await searchSidebar(page, newTitle);
            await expect(page.getByText(newTitle, { exact: true })).toBeVisible();
            await expect(page.getByText(originalTitle, { exact: true })).toHaveCount(0);
        } finally {
            await deleteConversation(page, convId);
        }
    });

    test("deletes a conversation from the sidebar", async ({ authedPage: page }) => {
        const title = uniqueTitle("Delete-Me");
        let convId: string | null = null;
        let alreadyDeleted = false;

        try {
            await page.goto("/playground/chat");
            await settled(page);
            await ensureChatModel(page);
            await sendStreamingPrompt(page, "tokens=5 delay=5 delete-target-marker-m3n4");
            await waitForReplyDone(page);
            convId = conversationIdFromUrl(page);
            expect(convId).not.toBeNull();
            await patchTitle(page, convId!, title);

            // Leave the conversation being deleted so removal doesn't also
            // trigger the "was I looking at this one?" full-navigation path
            // — keeps this test scoped to "the row disappears".
            await page.goto("/playground/chat");
            await settled(page);
            await searchSidebar(page, title);

            const row = page.locator("a").filter({ hasText: title });
            await row.getByRole("button").click();
            await page.getByRole("menuitem", { name: "Delete" }).click();

            await expect(page.getByRole("alertdialog")).toBeVisible();
            await expect(page.getByText("Delete conversation")).toBeVisible();
            await page.getByRole("button", { name: "Delete", exact: true }).click();

            await expect(page.getByText(title, { exact: true })).toHaveCount(0);
            alreadyDeleted = true;
        } finally {
            if (!alreadyDeleted) await deleteConversation(page, convId);
        }
    });
});
