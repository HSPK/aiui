import { test, expect, settled } from "../support/fixtures";
import { recordMetric } from "./support/report";
import { composer, ensureModelSelected, sendStreamingPrompt } from "./support/chat";

// Two things a cold-load benchmark can never see:
//
//   1. How long a client-side route transition takes. After the first load,
//      every navigation is SPA — that latency is most of the perceived speed
//      of the app, and none of the Web Vitals capture it.
//   2. Whether a long streaming session leaks. The chat page holds message
//      state, an AbortController, a reader and a throttled updater per send;
//      a leak there degrades a long working session rather than a page load.

const HOPS = [
    ["/providers", "/logs"],
    ["/logs", "/mcp"],
    ["/mcp", "/settings"],
    ["/settings", "/providers"],
] as const;

test.describe("client-side navigation", () => {
    test("route transitions settle quickly", async ({ authedPage: page }) => {
        await page.goto("/providers");
        await settled(page);

        const timings: number[] = [];
        for (const [, to] of HOPS) {
            const name = to.replace("/", "");
            const link = page.getByRole("link", { name: new RegExp(name, "i") }).first();
            if ((await link.count()) === 0) continue;

            const start = Date.now();
            await link.click();
            await page.waitForURL((u) => u.pathname.startsWith(to), { timeout: 15_000 });
            // Wait for the destination to actually paint content, not just for
            // the URL to change — otherwise this measures nothing.
            await expect(page.locator("body")).toContainText(new RegExp(name, "i"), { timeout: 15_000 });
            timings.push(Date.now() - start);
        }

        expect(timings.length, "no navigable links found").toBeGreaterThan(0);
        const sorted = timings.slice().sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length / 2)];
        const worst = sorted[sorted.length - 1];

        recordMetric({
            group: "navigation",
            name: "SPA route transition",
            values: { hops: timings.length, p50_ms: p50, worst_ms: worst },
        });

        expect(worst, "slowest client-side route transition").toBeLessThan(2000);
    });
});

test.describe("memory", () => {
    test("repeated streaming sessions do not grow the heap without bound", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await ensureModelSelected(page);

        const cdp = await page.context().newCDPSession(page);
        const heap = async (): Promise<number> => {
            // Collect first so we measure retained memory, not garbage.
            await cdp.send("HeapProfiler.collectGarbage");
            const { result } = await cdp.send("Runtime.evaluate", {
                expression: "performance.memory ? performance.memory.usedJSHeapSize : 0",
                returnByValue: true,
            });
            return (result.value as number) ?? 0;
        };

        // One warm-up send so lazily-loaded chunks and caches are already paid
        // for and don't count as "growth".
        const warm = await sendStreamingPrompt(page, "warmup tokens=40 delay=2");
        await expect.poll(() => warm.sawTokens(), { timeout: 30_000 }).toBe(true);
        await page.waitForTimeout(400);

        const before = await heap();

        for (let i = 0; i < 5; i++) {
            const s = await sendStreamingPrompt(page, `leak probe ${i} tokens=60 delay=2`);
            await expect.poll(() => s.sawTokens(), { timeout: 30_000 }).toBe(true);
            await page.waitForTimeout(200);
        }
        await page.waitForTimeout(600);
        const after = await heap();

        const growthMb = (after - before) / (1024 * 1024);
        recordMetric({
            group: "memory",
            name: "5 streaming sends",
            values: {
                before_mb: Number((before / 1048576).toFixed(1)),
                after_mb: Number((after / 1048576).toFixed(1)),
                growth_mb: Number(growthMb.toFixed(1)),
            },
        });

        // Message history legitimately grows, so this is a sanity bound on
        // runaway retention (listeners, abandoned readers), not a strict
        // no-growth assertion.
        expect(growthMb, "heap growth across 5 streaming sends").toBeLessThan(25);
    });
});
