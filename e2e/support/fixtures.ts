import { test as base, expect, type Page } from "@playwright/test";

export const ADMIN = { username: "admin", password: "e2e-password" } as const;
const UPSTREAM = `http://127.0.0.1:${process.env.FAKE_UPSTREAM_PORT || 4599}/v1`;

// NOTE: authentication happens through the real login form, not an API call.
// The session cookie is `secure: true` under NODE_ENV=production (see
// lib/server/auth/session.ts), and Playwright's API client refuses to store a
// Secure cookie delivered over http — only the browser's own network stack
// accepts it, because Chromium treats localhost as a trustworthy origin.
// Once the browser holds the cookie, `page.request` reuses the same jar, so
// API-driven setup works from there.

export async function loginViaUi(page: Page): Promise<void> {
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await page.getByLabel(/username/i).fill(ADMIN.username);
    await page.getByLabel(/password/i).fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Register the fake upstream once so model pickers have something to show.
 *
 *  Runs INSIDE the page: only the browser's own network stack sends the
 *  Secure session cookie over http, and this is the exact `credentials:
 *  "include"` path the application itself uses. */
export async function ensureProvider(page: Page): Promise<void> {
    const result = await page.evaluate(async (upstream) => {
        const list = await fetch("/api/providers", { credentials: "include" });
        if (list.ok) {
            const body = await list.json();
            if (Array.isArray(body?.data) && body.data.some((p: { name: string }) => p.name === "e2e")) {
                return { ok: true, status: 200, text: "already registered" };
            }
        }
        const res = await fetch("/api/providers", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "e2e", base_url: upstream, api_key: "sk-e2e",
                adapter_id: "openai", enabled: true,
            }),
        });
        return { ok: res.ok, status: res.status, text: await res.text() };
    }, UPSTREAM);

    // A previous test may have won the race; a duplicate-name rejection is fine.
    if (!result.ok && result.status !== 400 && result.status !== 409) {
        throw new Error(`provider setup failed: ${result.status} ${result.text}`);
    }
}

export const test = base.extend<{ authedPage: Page }>({
    authedPage: async ({ page }, use) => {
        await loginViaUi(page);
        await ensureProvider(page);
        await use(page);
    },
});

export { expect };

/** Wait until the app has hydrated and the initial data fetches have settled. */
export async function settled(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await page.waitForLoadState("networkidle").catch(() => { /* streaming pages never idle */ });
}
