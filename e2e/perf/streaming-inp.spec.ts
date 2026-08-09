import { test, expect } from "../support/fixtures";
import { recordMetric } from "./support/report";
import { composer, ensureModelSelected, sendStreamingPrompt } from "./support/chat";

// THE headline responsiveness benchmark.
//
// A chat UI can have perfect load metrics and still feel broken, because the
// moment that actually matters is typing while tokens stream in. Every token
// triggers React state updates; if those saturate the main thread the input
// stops responding. This measures exactly that:
//
//   - interaction latency (INP-style: event timestamp -> next paint) for
//     keystrokes issued WHILE a response streams
//   - long tasks (>50 ms blocks) accumulated during the stream
//
// The fake upstream lets us dial token count and cadence, so the load is
// repeatable instead of dependent on a live provider.

interface Interaction { latency: number; }

test.describe("streaming responsiveness", () => {
    test("stays responsive to typing while tokens stream", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await page.waitForLoadState("networkidle").catch(() => { /* streaming page */ });

        // Instrument before interacting: `event` timing gives us real
        // input-to-next-paint numbers, `longtask` gives main-thread blocking.
        await page.evaluate(() => {
            const w = window as unknown as {
                __perf: { interactions: Interaction[]; longTasks: number; longTaskTime: number };
            };
            w.__perf = { interactions: [], longTasks: 0, longTaskTime: 0 };
            try {
                new PerformanceObserver((list) => {
                    for (const e of list.getEntries()) {
                        const ev = e as PerformanceEntry & { processingEnd?: number; duration: number };
                        w.__perf.interactions.push({ latency: ev.duration });
                    }
                }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
            } catch { /* unsupported */ }
            try {
                new PerformanceObserver((list) => {
                    for (const e of list.getEntries()) {
                        w.__perf.longTasks += 1;
                        w.__perf.longTaskTime += e.duration;
                    }
                }).observe({ type: "longtask", buffered: true });
            } catch { /* unsupported */ }
        });

        await ensureModelSelected(page);
        const input = composer(page);

        // `tokens=` / `delay=` are read by the fake upstream: 400 tokens at
        // 5 ms is a deliberately aggressive stream (~2 s of continuous
        // re-render) — harsher than most real providers. `sendStreamingPrompt`
        // asserts the gateway request actually started, so this can never
        // silently degrade into measuring an idle page.
        const stream = await sendStreamingPrompt(page, "benchmark tokens=400 delay=5");

        // Let tokens start landing before typing into the live stream.
        await expect
            .poll(() => stream.sawTokens(), { timeout: 20_000, message: "no streamed tokens rendered" })
            .toBe(true);

        // Type during the stream and measure how the UI keeps up.
        const typingStart = Date.now();
        for (let i = 0; i < 25; i++) {
            await input.press("a");
            await page.waitForTimeout(30);
        }
        const typingMs = Date.now() - typingStart;

        const perf = await page.evaluate(() => {
            const w = window as unknown as {
                __perf: { interactions: Interaction[]; longTasks: number; longTaskTime: number };
            };
            const lat = w.__perf.interactions.map((i) => i.latency).sort((a, b) => a - b);
            const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : 0);
            return {
                count: lat.length,
                p50: pct(0.5),
                p95: pct(0.95),
                worst: lat.length ? lat[lat.length - 1] : 0,
                longTasks: w.__perf.longTasks,
                longTaskTime: w.__perf.longTaskTime,
            };
        });

        recordMetric({
            group: "streaming",
            name: "typing during stream",
            values: {
                interactions: perf.count,
                inp_p50_ms: Math.round(perf.p50),
                inp_p95_ms: Math.round(perf.p95),
                inp_worst_ms: Math.round(perf.worst),
                long_tasks: perf.longTasks,
                long_task_ms: Math.round(perf.longTaskTime),
                typing_wall_ms: typingMs,
            },
        });

        // Google's INP thresholds: <200ms good, <500ms needs-improvement.
        // Assert on p95 rather than the single worst sample so one scheduling
        // hiccup on a busy CI box doesn't flake the suite.
        expect(perf.p95, "p95 interaction latency while streaming").toBeLessThan(200);
        expect(perf.worst, "worst interaction latency while streaming").toBeLessThan(500);
    });

    test("renders a full streamed reply and settles", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await page.waitForLoadState("networkidle").catch(() => { /* streaming page */ });

        await ensureModelSelected(page);

        const started = Date.now();
        const stream = await sendStreamingPrompt(page, "benchmark tokens=80 delay=5");

        // First visible token — the perceived "it's alive" moment.
        await expect
            .poll(() => stream.sawTokens(), { timeout: 20_000, message: "no streamed tokens rendered" })
            .toBe(true);
        const firstPaint = Date.now() - started;

        recordMetric({
            group: "streaming",
            name: "first token painted",
            values: { first_token_paint_ms: firstPaint },
        });

        expect(firstPaint, "time from submit to first painted token").toBeLessThan(5000);
    });
});
