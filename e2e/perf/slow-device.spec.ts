import { test, expect } from "../support/fixtures";
import { recordMetric } from "./support/report";
import { composer, ensureModelSelected, sendStreamingPrompt } from "./support/chat";

// The same responsiveness questions, but on a device that isn't a datacenter
// CPU on loopback.
//
// Every other number in this suite is measured with unthrottled CPU and zero
// network latency, which flatters the app. A self-hosted tool is frequently
// opened from a laptop on wifi, or a mid-range machine running the model
// locally and competing for CPU. 4x CPU throttling is Lighthouse's default
// "mid-tier device" multiplier.

const CPU_THROTTLE = 4;

test.describe("slow device", () => {
    test("chat page is still usable with 4x CPU throttling", async ({ authedPage: page }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });

        const start = Date.now();
        await page.goto("/playground/chat");
        await expect(composer(page)).toBeVisible({ timeout: 30_000 });
        const interactiveMs = Date.now() - start;

        const vitals = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
            return { fcp, dcl: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0 };
        });

        recordMetric({
            group: "slow-device",
            name: `/playground/chat @${CPU_THROTTLE}x CPU`,
            values: {
                composer_visible_ms: interactiveMs,
                fcp_ms: Math.round(vitals.fcp),
                dcl_ms: Math.round(vitals.dcl),
            },
        });

        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        expect(interactiveMs, "time until the chat composer is usable on a mid-tier device")
            .toBeLessThan(8000);
    });

    test("typing stays responsive while streaming on a throttled CPU", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await ensureModelSelected(page);

        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });

        await page.evaluate(() => {
            const w = window as unknown as { __p: { lat: number[]; long: number; longMs: number } };
            w.__p = { lat: [], long: 0, longMs: 0 };
            try {
                new PerformanceObserver((l) => {
                    for (const e of l.getEntries()) w.__p.lat.push(e.duration);
                }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
            } catch { /* unsupported */ }
            try {
                new PerformanceObserver((l) => {
                    for (const e of l.getEntries()) { w.__p.long += 1; w.__p.longMs += e.duration; }
                }).observe({ type: "longtask", buffered: true });
            } catch { /* unsupported */ }
        });

        const stream = await sendStreamingPrompt(page, "throttled benchmark tokens=250 delay=8");
        await expect.poll(() => stream.sawTokens(), { timeout: 30_000 }).toBe(true);

        const input = composer(page);
        for (let i = 0; i < 20; i++) {
            await input.press("b");
            await page.waitForTimeout(40);
        }

        const p = await page.evaluate(() => {
            const w = window as unknown as { __p: { lat: number[]; long: number; longMs: number } };
            const s = w.__p.lat.slice().sort((a, b) => a - b);
            const pct = (q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
            return { n: s.length, p50: pct(0.5), p95: pct(0.95), worst: s.at(-1) ?? 0, long: w.__p.long, longMs: w.__p.longMs };
        });

        recordMetric({
            group: "slow-device",
            name: `typing during stream @${CPU_THROTTLE}x CPU`,
            values: {
                interactions: p.n,
                inp_p50_ms: Math.round(p.p50),
                inp_p95_ms: Math.round(p.p95),
                inp_worst_ms: Math.round(p.worst),
                long_tasks: p.long,
                long_task_ms: Math.round(p.longMs),
            },
        });

        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

        // Even throttled, stay inside the "needs improvement" band (<500ms);
        // p95 should still clear the "good" bar.
        expect(p.p95, "p95 interaction latency on a throttled CPU").toBeLessThan(200);
        expect(p.worst, "worst interaction latency on a throttled CPU").toBeLessThan(500);
    });
});
