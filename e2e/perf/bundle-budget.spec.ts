import { test, expect } from "../support/fixtures";
import { measureTransfer, fmtBytes } from "./support/metrics";
import { recordMetric } from "./support/report";

// Transferred-bytes budget per route.
//
// This is the metric that actually governs perceived responsiveness on a cold
// load: the server answers in ~3 ms, so everything the user waits for is
// download + parse + execute of the client bundle. Budgets are set slightly
// above today's measured values so the suite fails on regression rather than
// on the current baseline — tighten them as the bundle shrinks.

const BUDGETS: Record<string, number> = {
    "/": 900 * 1024,
    "/playground/chat": 780 * 1024,
    "/logs": 860 * 1024,
    "/providers": 720 * 1024,
    "/settings": 740 * 1024,
};

test.describe("bundle size budget", () => {
    for (const [route, budget] of Object.entries(BUDGETS)) {
        test(`${route} stays under ${fmtBytes(budget)} of JS`, async ({ authedPage: page }) => {
            const t = await measureTransfer(page, route);

            recordMetric({
                group: "bundle",
                name: route,
                values: {
                    js_kb: Math.round(t.js / 1024),
                    css_kb: Math.round(t.css / 1024),
                    total_kb: Math.round(t.total / 1024),
                    requests: t.requests,
                },
                notes: t.files.slice(0, 5).join(", "),
            });

            expect(
                t.js,
                `${route} ships ${fmtBytes(t.js)} of JS (budget ${fmtBytes(budget)}).\n` +
                `Largest: ${t.files.slice(0, 5).join(", ")}`,
            ).toBeLessThan(budget);
        });
    }
});
