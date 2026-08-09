import { devices } from "@playwright/test";
import { test, expect, settled } from "../support/fixtures";

// Mobile layout and touch interaction.
//
// The repo has a commit titled "mobile scroll/focus fixes" with no test behind
// it. jsdom has no layout, so nothing in the unit suite can catch a sidebar
// that covers the whole screen or a composer pushed off-viewport by the
// on-screen keyboard.

test.use({ ...devices["Pixel 7"] });

const PAGES = ["/playground/chat", "/logs", "/providers", "/settings"] as const;

test.describe("mobile viewport", () => {
    for (const path of PAGES) {
        test(`${path} fits the viewport without horizontal scroll`, async ({ authedPage: page }) => {
            await page.goto(path);
            await settled(page);

            const overflow = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }));

            // A few px of rounding is fine; a real overflow is tens of px.
            expect(
                overflow.scrollWidth - overflow.clientWidth,
                `${path} scrolls horizontally on mobile (${overflow.scrollWidth} > ${overflow.clientWidth})`,
            ).toBeLessThanOrEqual(2);
        });
    }

    test("chat composer stays reachable and usable", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);

        const composer = page.getByPlaceholder(/message ai/i);
        await expect(composer).toBeVisible();

        const box = await composer.boundingBox();
        const viewport = page.viewportSize();
        expect(box, "composer has no layout box").not.toBeNull();
        expect(viewport).not.toBeNull();
        // Must be inside the visible viewport, not pushed off the bottom.
        expect(box!.y).toBeLessThan(viewport!.height);
        expect(box!.y + box!.height).toBeGreaterThan(0);

        await composer.tap();
        await composer.fill("hello from mobile");
        await expect(composer).toHaveValue("hello from mobile");
    });

    test("primary tap targets are large enough for touch", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);

        // WCAG 2.5.8 asks for 24x24 CSS px minimum for pointer targets.
        const tooSmall = await page.evaluate(() => {
            const bad: string[] = [];
            for (const el of Array.from(document.querySelectorAll("button, a[href], [role=button]"))) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.width < 24 || r.height < 24) {
                    const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 24);
                    bad.push(`${Math.round(r.width)}x${Math.round(r.height)} "${name}"`);
                }
            }
            return bad;
        });

        expect(tooSmall, `tap targets under 24x24 CSS px:\n${tooSmall.join("\n")}`).toEqual([]);
    });
});
