import { test, expect, settled } from "../support/fixtures";
import { composer, sendStreamingPrompt } from "../perf/support/chat";
import { ensureChatModel } from "./chat-model";
import type { Page } from "@playwright/test";

// Depth pass over in-flight chat control: stopping a stream mid-flight,
// regenerating (sibling/branch creation + selection), and — documenting a
// genuine gap — editing a sent user message.
//
// Shared DB across spec files: every conversation created here is deleted
// again in a `finally` block.

async function waitForReplyDone(page: Page): Promise<void> {
    await expect(page.getByTitle("Regenerate response")).toBeVisible({ timeout: 20_000 });
}

function conversationIdFromUrl(page: Page): string | null {
    return new URL(page.url()).searchParams.get("c");
}

async function deleteConversation(page: Page, id: string | null): Promise<void> {
    if (!id) return;
    await page.evaluate(async (id) => {
        await fetch(`/api/conversations/${id}`, { method: "DELETE", credentials: "include" });
    }, id);
}

/** Sibling cards render inside a single horizontally-scrollable group, one
 *  `.rounded-xl` card per sibling — see components/playground/message-list.tsx
 *  (the group wrapper) and chat-message.tsx (`isSibling` styling). */
function siblingCards(page: Page) {
    return page.locator(".overflow-x-auto.scrollbar-none .rounded-xl");
}

/** Scopes a lookup to the message list's scroll viewport (the only
 *  `<ScrollArea>` under components/playground — see chat-flow.tsx), as
 *  opposed to the sidebar. A brand-new conversation's title defaults to
 *  the raw first-message text, so an unscoped `getByText(marker)` can also
 *  match the sidebar row — a real collision whenever the async title
 *  generator hasn't yet overwritten it. */
function messageArea(page: Page) {
    return page.locator('[data-slot="scroll-area-viewport"]');
}

test.describe("chat playground — streaming control", () => {
    test("stopping mid-stream halts generation, keeps partial content, and returns to idle", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);
        await ensureChatModel(page);

        let convId: string | null = null;
        try {
            // Long + slow enough that stopping partway is unambiguous.
            await sendStreamingPrompt(page, "tokens=400 delay=20 stop-mid-stream-marker-u1v2");
            convId = conversationIdFromUrl(page);

            // Wait for real partial content before stopping — otherwise
            // "stop" might race the very first chunk and prove nothing.
            await expect(page.getByText(/Streaming responsiveness/)).toBeVisible({ timeout: 10_000 });

            const stopButton = page.locator('form button[type="button"]').last();
            await expect(stopButton).toBeVisible();
            await stopButton.click();

            // No error surfaced — a user-initiated stop is not a failure.
            await expect(page.getByText("Generation failed")).toHaveCount(0);

            // Partial content survives the stop (not wiped/reset).
            await expect(page.getByText(/Streaming responsiveness/)).toBeVisible();

            // UI is idle/sendable again: typing reveals a working Send button
            // (canSubmit is gated on `!isLoading`, so this is a real signal,
            // not just "the DOM still has a button node somewhere").
            await composer(page).fill("ready for another message");
            await expect(page.locator('form button[type="submit"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteConversation(page, convId);
        }
    });

    test("regenerating creates a sibling; selecting the other one flips which is Active", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);
        await ensureChatModel(page);

        let convId: string | null = null;
        try {
            await sendStreamingPrompt(page, "tokens=6 delay=5 regenerate-marker-w3x4");
            await waitForReplyDone(page);
            convId = conversationIdFromUrl(page);

            await page.getByTitle("Regenerate response").click();
            // The regenerated reply is a NEW sibling — wait for its own
            // completion (Regenerate re-appears once the new one settles).
            await waitForReplyDone(page);

            const cards = siblingCards(page);
            await expect(cards).toHaveCount(2);

            // Exactly one sibling is marked Active at a time; by default
            // it's the most recent (tail) one.
            await expect(cards.nth(1).getByText("Active")).toBeVisible();
            await expect(cards.nth(0).getByText("Active")).toHaveCount(0);

            // Selecting the other sibling flips which one is Active.
            await cards.nth(0).click();
            await expect(cards.nth(0).getByText("Active")).toBeVisible();
            await expect(cards.nth(1).getByText("Active")).toHaveCount(0);
        } finally {
            await deleteConversation(page, convId);
        }
    });

    // --- Genuine gap, not a regression in this change: there is no way to
    // edit a previously-sent user message and resend it. See the final
    // report for the full file:line citations and user-impact writeup.
    // Written as `test.fail()` per the assignment's rule for a confirmed
    // bug: assert the CORRECT/desired behaviour so the test starts passing
    // the moment the feature ships.
    test.fail(
        "editing a sent user message and resending branches like assistant regenerate (BUG: no edit affordance exists)",
        async ({ authedPage: page }) => {
            await page.goto("/playground/chat");
            await settled(page);
            await ensureChatModel(page);

            let convId: string | null = null;
            try {
                await sendStreamingPrompt(page, "tokens=5 delay=5 edit-me-marker-y5z6");
                await waitForReplyDone(page);
                convId = conversationIdFromUrl(page);

                const userBubble = messageArea(page).getByText("edit-me-marker-y5z6");
                await userBubble.hover();

                // Desired behaviour: an Edit affordance on the user's own
                // message, symmetric with the assistant's Regenerate button
                // (components/playground/chat-message.tsx:488-499). Today
                // there is none — only `role === "assistant"` gets any
                // action beyond Copy, and there is no PATCH-message-content
                // route (app/api/messages/[id]/ only has rate/route.ts).
                await expect(page.getByTitle(/edit message/i)).toBeVisible({ timeout: 3_000 });

                await page.getByTitle(/edit message/i).click();
                await page.getByRole("textbox").last().fill("edit-me-marker-y5z6 edited");
                await page.keyboard.press("Enter");

                // Editing a user message should branch exactly like
                // regenerate does for assistant messages: a new sibling
                // group at the user-message level with Active/Context
                // navigation between the original and edited wording.
                const cards = siblingCards(page);
                await expect(cards).toHaveCount(2);
            } finally {
                await deleteConversation(page, convId);
            }
        },
    );
});
