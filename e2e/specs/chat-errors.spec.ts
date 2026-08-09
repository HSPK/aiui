import { test, expect, settled } from "../support/fixtures";
import { composer, sendStreamingPrompt } from "../perf/support/chat";
import { ensureChatModel } from "./chat-model";
import type { Page } from "@playwright/test";

// Depth pass over upstream-failure handling: Loom explicitly special-cases
// an HTTP-200-but-`{error:{message}}` upstream body (the shape self-hosted
// OpenAI-compatible servers commonly emit for a "soft" failure — see
// lib/server/api-variants/index.ts:extractUpstreamError and
// chat-completions.ts). A failure must never render as a normal green
// bubble with no way to recover.
//
// Uses the fake upstream's `fail=1` / `fail=once` prompt hooks (see
// e2e/support/fake-upstream.mjs — a backwards-compatible, opt-in addition:
// existing prompts never contain these substrings, so default behaviour for
// every other spec is unchanged).
//
// Shared DB across spec files: every conversation created here is deleted
// again in a `finally` block.

function conversationIdFromUrl(page: Page): string | null {
    return new URL(page.url()).searchParams.get("c");
}

async function deleteConversation(page: Page, id: string | null): Promise<void> {
    if (!id) return;
    await page.evaluate(async (id) => {
        await fetch(`/api/conversations/${id}`, { method: "DELETE", credentials: "include" });
    }, id);
}

/** The failed-generation error card (components/playground/chat-message.tsx)
 *  is the correct completion signal for a request we expect to fail —
 *  `getByTitle("Regenerate response")` never appears for a failed slot
 *  (it requires a successful `generation_id`), so a distinct wait is
 *  needed here rather than reusing the happy-path helper. */
async function waitForErrorCard(page: Page): Promise<void> {
    await expect(page.getByText("Generation failed")).toBeVisible({ timeout: 20_000 });
}

test.describe("chat playground — upstream error handling", () => {
    test("an upstream failure renders a retryable error card, not a silent success", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);
        await ensureChatModel(page);

        let convId: string | null = null;
        try {
            await sendStreamingPrompt(page, "tokens=5 delay=5 fail=1 error-card-marker-p1q2");
            await waitForErrorCard(page);
            convId = conversationIdFromUrl(page);

            // The failure message itself is surfaced, not swallowed.
            await expect(page.getByText("Simulated upstream failure")).toBeVisible();

            // A retry affordance exists...
            const retryButton = page.getByRole("button", { name: "Retry" });
            await expect(retryButton).toBeVisible();

            // ...and there is no successful-looking assistant bubble sitting
            // alongside the error (this prompt's tokens are never emitted
            // because the fake upstream fails before any content chunk).
            await expect(page.getByText("Streaming responsiveness")).toHaveCount(0);
        } finally {
            await deleteConversation(page, convId);
        }
    });

    test("retrying a failed generation recovers once the upstream succeeds", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);
        await ensureChatModel(page);

        let convId: string | null = null;
        try {
            // `fail=once` fails only the first attempt for this exact
            // prompt — the retry (same prompt, same conversation) then
            // succeeds, letting this test assert genuine recovery rather
            // than just "the button exists".
            await sendStreamingPrompt(page, "tokens=5 delay=5 fail=once retry-recovers-marker-r3s4");
            await waitForErrorCard(page);
            convId = conversationIdFromUrl(page);

            await page.getByRole("button", { name: "Retry" }).click();

            // Recovery: the error card is gone and real content replaced it.
            await expect(page.getByText("Generation failed")).toHaveCount(0);
            await expect(page.getByText("Streaming responsiveness")).toBeVisible();
            await expect(page.getByTitle("Regenerate response")).toBeVisible();
        } finally {
            await deleteConversation(page, convId);
        }
    });
});
