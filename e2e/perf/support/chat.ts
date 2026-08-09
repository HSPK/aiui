import { expect, type Locator, type Page } from "@playwright/test";

/** The composer, not the sidebar's "Search chats" box — `getByRole("textbox")`
 *  matches both and the search box comes first in the DOM. Targeting the wrong
 *  one silently turns a streaming benchmark into a measurement of an idle
 *  page, so this is deliberately specific. */
export function composer(page: Page): Locator {
    return page.getByPlaceholder(/message ai/i);
}

export interface StreamHandle {
    /** True once assistant text from the fake upstream is visible in the DOM. */
    sawTokens: () => Promise<boolean>;
}

/**
 * Sends a prompt and asserts a real streaming request actually started.
 *
 * Without this guard a selector regression (or a missing model) produces a
 * benchmark that reports beautiful numbers for a page doing nothing.
 */
export async function sendStreamingPrompt(
    page: Page,
    prompt: string,
): Promise<StreamHandle> {
    const input = composer(page);
    await expect(input, "chat composer not found — check the placeholder").toBeVisible({ timeout: 20_000 });

    const request = page.waitForRequest(
        (r) => r.url().includes("/api/playground/chat") && r.method() === "POST",
        { timeout: 20_000 },
    );
    const response = page.waitForResponse(
        (r) => r.url().includes("/api/playground/chat"),
        { timeout: 20_000 },
    );

    await input.fill(prompt);
    await input.press("Enter");

    await request;
    const res = await response;
    expect(res.status(), "gateway rejected the benchmark prompt").toBeLessThan(400);

    // Deliberately no handle on `res.finished()`: an un-awaited pending
    // promise makes Playwright abort the test with "Test ended" when the
    // stream outlives the measurement window, which is the normal case here.
    return {
        sawTokens: async () =>
            (await page.locator("body").innerText()).includes("Streaming responsiveness is measured"),
    };
}

/** Picks the first available model if the composer needs one selected. */
export async function ensureModelSelected(page: Page): Promise<void> {
    // The e2e provider exposes `e2e-chat`; the picker auto-selects when the
    // catalog has exactly one usable model, so this is a no-op in practice.
    // Kept as an explicit hook so a future multi-model fixture can override.
    await expect(page.locator("body")).toContainText(/e2e-chat/i, { timeout: 20_000 });
}
