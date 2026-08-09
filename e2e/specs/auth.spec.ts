import { test, expect, settled } from "../support/fixtures";
import { ADMIN } from "../support/fixtures";

test.describe("authentication", () => {
    test("rejects a wrong password without navigating away", async ({ page }) => {
        await page.goto("/login");
        await settled(page);
        await page.getByLabel(/username/i).fill(ADMIN.username);
        await page.getByLabel(/password/i).fill("definitely-not-the-password");
        await page.getByRole("button", { name: /sign in|log in/i }).click();
        await expect(page).toHaveURL(/\/login/);
    });

    test("signs in and lands on the dashboard", async ({ page }) => {
        await page.goto("/login");
        await settled(page);
        await page.getByLabel(/username/i).fill(ADMIN.username);
        await page.getByLabel(/password/i).fill(ADMIN.password);
        await page.getByRole("button", { name: /sign in|log in/i }).click();
        await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    });

    test("bounces an anonymous visitor off a protected page", async ({ page }) => {
        await page.context().clearCookies();
        await page.goto("/providers");
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });

    test("keeps the session across a full reload", async ({ authedPage: page }) => {
        await page.goto("/providers");
        await settled(page);
        await page.reload();
        await settled(page);
        await expect(page).not.toHaveURL(/\/login/);
    });
});
