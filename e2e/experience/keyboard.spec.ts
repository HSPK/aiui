import { test, expect, settled } from "../support/fixtures";

// Keyboard and focus behaviour.
//
// Dialog focus trapping, Escape-to-close and visible focus rings are pure
// browser concerns — jsdom reports no layout and no real focus ring, so none
// of this is reachable from the component suite.

test.describe("keyboard and focus", () => {
    test("a dialog traps focus and closes on Escape", async ({ authedPage: page }) => {
        await page.goto("/providers");
        await settled(page);

        const open = page.getByRole("button", { name: /add provider|new provider/i }).first();
        await expect(open).toBeVisible({ timeout: 15_000 });
        await open.click();

        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();

        // Focus must move into the dialog, not stay on the page behind it.
        const focusInside = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            return !!d && !!document.activeElement && d.contains(document.activeElement);
        });
        expect(focusInside, "focus stayed outside the opened dialog").toBe(true);

        // Tabbing repeatedly must never escape the dialog.
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press("Tab");
            const stillInside = await page.evaluate(() => {
                const d = document.querySelector('[role="dialog"]');
                return !!d && !!document.activeElement && d.contains(document.activeElement);
            });
            expect(stillInside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
        }

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
    });

    test("the chat composer is reachable by keyboard alone", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);

        await page.keyboard.press("Tab");
        const reached = await page.evaluate(() => {
            const start = document.activeElement;
            return !!start && start !== document.body;
        });
        expect(reached, "Tab did not move focus into the page").toBe(true);

        // And the composer itself accepts focus + typing.
        const composer = page.getByPlaceholder(/message ai/i);
        await composer.focus();
        await page.keyboard.type("typed with the keyboard");
        await expect(composer).toHaveValue("typed with the keyboard");
    });

    test("focused controls show a visible focus indicator", async ({ authedPage: page }) => {
        await page.goto("/providers");
        await settled(page);

        const button = page.getByRole("button").first();
        await button.focus();

        const ring = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
                outlineWidth: s.outlineWidth,
                outlineStyle: s.outlineStyle,
                boxShadow: s.boxShadow,
                ring: s.getPropertyValue("--tw-ring-shadow"),
            };
        });

        expect(ring, "nothing was focused").not.toBeNull();
        const hasIndicator =
            (ring!.outlineStyle !== "none" && parseFloat(ring!.outlineWidth) > 0) ||
            (ring!.boxShadow !== "none" && ring!.boxShadow !== "") ||
            (ring!.ring !== "" && ring!.ring !== "0 0 #0000");
        expect(hasIndicator, `focused control has no visible focus indicator: ${JSON.stringify(ring)}`).toBe(true);
    });
});
