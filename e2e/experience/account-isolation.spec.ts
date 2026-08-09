import type { Page } from "@playwright/test";
import { test, expect, settled } from "../support/fixtures";
import { composer } from "../perf/support/chat";

// Shared-browser safety.
//
// `context/auth-context.tsx` clears the TanStack Query cache on both login and
// logout specifically so one account can't see another's conversations. That
// guarantee only exists in a real browser with a live cache — no unit test can
// prove it, and getting it wrong leaks data between users on a shared machine.

const SECOND = { username: `member-${Date.now()}`, password: "second-user-pw-123" };

async function loginAs(page: Page, u: { username: string; password: string }): Promise<void> {
    await page.goto("/login");
    await settled(page);
    await page.getByLabel(/username/i).fill(u.username);
    await page.getByLabel(/password/i).fill(u.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function logout(page: Page): Promise<void> {
    const status = await page.evaluate(async () => {
        const r = await fetch("/api/logout", { method: "POST", credentials: "include" });
        return r.status;
    });
    expect(status).toBeLessThan(400);
    await page.goto("/login");
    await settled(page);
}

/** Idempotent: a duplicate username just means a previous test made it. */
async function ensureSecondUser(page: Page): Promise<void> {
    const res = await page.evaluate(async (u) => {
        const r = await fetch("/api/users", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u.username, password: u.password, role: "user" }),
        });
        return { status: r.status, body: await r.text() };
    }, SECOND);
    if (res.status >= 400 && res.status !== 400 && res.status !== 409) {
        throw new Error(`could not create second user: ${res.status} ${res.body}`);
    }
}

test.describe("account isolation", () => {
    test("a second account cannot see the first account's conversation", async ({ authedPage: page }) => {
        await ensureSecondUser(page);

        // Conversations are created implicitly by sending a message, so drive
        // the real composer rather than inventing an endpoint.
        const marker = `isolation-probe-${Date.now()}`;
        await page.goto("/playground/chat");
        await settled(page);
        const input = composer(page);
        await expect(input).toBeVisible({ timeout: 20_000 });
        await input.fill(`${marker} tokens=5 delay=2`);
        await input.press("Enter");

        // The message must actually be persisted before we switch accounts.
        await expect.poll(async () => {
            const r = await page.evaluate(async () => {
                const res = await fetch("/api/conversations?page=1&page_size=50&sort=-updated_at", { credentials: "include" });
                return res.ok ? JSON.stringify(await res.json()) : "";
            });
            return r.includes(marker);
        }, { timeout: 20_000, message: "admin's conversation never persisted" }).toBe(true);

        await logout(page);
        await loginAs(page, SECOND);
        await page.goto("/playground/chat");
        await settled(page);

        await expect(
            page.locator("body"),
            "the previous account's conversation is still rendered after switching users",
        ).not.toContainText(marker);

        const visible = await page.evaluate(async () => {
            const r = await fetch("/api/conversations?page=1&page_size=50&sort=-updated_at", { credentials: "include" });
            return r.ok ? JSON.stringify(await r.json()) : `error ${r.status}`;
        });
        expect(visible, "server returned another user's conversation").not.toContain(marker);
    });

    test("a non-admin does not get user-management controls", async ({ authedPage: page }) => {
        await ensureSecondUser(page);
        await logout(page);
        await loginAs(page, SECOND);

        await page.goto("/settings/users");
        await settled(page);

        const adminControls = await page
            .getByRole("button", { name: /new user|add user|create user/i })
            .count();
        expect(adminControls, "non-admin sees user-creation controls").toBe(0);
    });

    test("logging out blocks access to protected pages", async ({ authedPage: page }) => {
        await page.goto("/providers");
        await settled(page);
        await logout(page);

        await page.goto("/providers");
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });
});
