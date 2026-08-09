import { test, expect, settled } from "../support/fixtures";

const ROUTES = [
    { path: "/playground/chat", marker: /chat/i },
    { path: "/logs", marker: /logs/i },
    { path: "/providers", marker: /providers/i },
    { path: "/mcp", marker: /mcp/i },
    { path: "/settings", marker: /settings/i },
] as const;

test.describe("dashboard navigation", () => {
    for (const { path, marker } of ROUTES) {
        test(`renders ${path} without a client error`, async ({ authedPage: page }) => {
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

            const res = await page.goto(path);
            expect(res?.status(), `${path} returned ${res?.status()}`).toBeLessThan(400);
            await settled(page);

            await expect(page.locator("body")).toContainText(marker);
            // Next.js emits a benign hydration notice in some dev paths; a
            // production build should be clean.
            const real = errors.filter((e) => !/favicon|ResizeObserver loop/i.test(e));
            expect(real, `client errors on ${path}:\n${real.join("\n")}`).toEqual([]);
        });
    }

    test("navigates between pages client-side without a full reload", async ({ authedPage: page }) => {
        await page.goto("/providers");
        await settled(page);
        // Tag the document; a client-side transition preserves it, a full
        // navigation wipes it.
        await page.evaluate(() => { (window as unknown as { __spa: boolean }).__spa = true; });

        await page.getByRole("link", { name: /logs/i }).first().click();
        await expect(page).toHaveURL(/\/logs/, { timeout: 15_000 });

        const preserved = await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa === true);
        expect(preserved, "navigation caused a full document reload").toBe(true);
    });
});
