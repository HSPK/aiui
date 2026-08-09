// Captures the README / docs screenshots against a throwaway instance
// seeded by scripts/demo-seed.mjs.
//
//   node scripts/demo-shots.mjs http://127.0.0.1:3100 docs/assets
//
// Runs at deviceScaleFactor 2 so the images stay sharp on HiDPI displays
// and when GitHub scales them down inside a README table.

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const OUT = process.argv[3] || "docs/assets";
const THEMES = (process.env.THEMES || "light,dark").split(",");

const SHOTS = [
    { name: "dashboard", path: "/", settle: 2500 },
    { name: "playground-chat", path: "/playground/chat", settle: 2500, conversation: "Token bucket rate limiter" },
    { name: "playground-compare", path: "/playground/chat", settle: 3000, conversation: "MCP vs. function calling" },
    { name: "logs", path: "/logs", settle: 2000 },
    // A chat row, not an embedding one: it's the only capability whose
    // detail pane has a prompt, a completion and a TTFT to show.
    { name: "log-detail", path: "/logs", settle: 2000, openLogWith: "gpt-4o" },
    { name: "providers", path: "/providers", settle: 2000 },
    { name: "mcp", path: "/mcp", settle: 2000 },
    { name: "mcp-catalogue", path: "/mcp/presets", settle: 2000 },
    { name: "api-keys", path: "/settings/api-keys", settle: 1800 },
    { name: "users", path: "/settings/users", settle: 1800 },
    { name: "playground-embedding", path: "/playground/embedding", settle: 1800 },
];

async function login(page) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="user_name"], input[type="text"]').first().fill("admin");
    await page.locator('input[type="password"]').first().fill("demo-admin-pw");
    await page.getByRole("button", { name: /sign in|log ?in|登录/i }).first().click();
    await page.waitForTimeout(3000);
}

async function setTheme(page, theme) {
    await page.evaluate((t) => {
        localStorage.setItem("loom-theme", JSON.stringify({ id: "default", scheme: t }));
    }, theme);
}

async function main() {
    await mkdir(OUT, { recursive: true });
    const browser = await chromium.launch();

    for (const theme of THEMES) {
        const ctx = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 2,
            colorScheme: theme,
        });
        const page = await ctx.newPage();
        await login(page);
        await setTheme(page, theme);

        for (const shot of SHOTS) {
            await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(shot.settle);

            if (shot.conversation) {
                const link = page.locator('a[href*="/playground/chat?c="]')
                    .filter({ hasText: shot.conversation }).first();
                if (!(await link.count())) throw new Error(`conversation not found: ${shot.conversation}`);
                await link.click();
                await page.waitForTimeout(3000);
            }
            if (shot.openLogWith) {
                const row = page.locator("table tbody tr")
                    .filter({ hasText: shot.openLogWith }).first();
                if (!(await row.count())) throw new Error(`no log row matching ${shot.openLogWith}`);
                await row.click();
                await page.waitForTimeout(2000);
            }

            const suffix = THEMES.length > 1 ? `-${theme}` : "";
            const file = `${OUT}/${shot.name}${suffix}.png`;
            await page.screenshot({ path: file });
            console.log("✓", file);
        }
        await ctx.close();
    }

    await browser.close();
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
