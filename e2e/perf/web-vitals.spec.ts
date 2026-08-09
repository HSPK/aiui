import { test, expect } from "../support/fixtures";
import { measureVitals } from "./support/metrics";
import { recordMetric } from "./support/report";

// Core Web Vitals for a COLD navigation to each key route, measured in a real
// Chromium against the production build. Budgets are deliberately generous
// for a self-hosted admin tool on loopback — they exist to catch regressions,
// not to chase a Lighthouse score.

const ROUTES = ["/playground/chat", "/logs", "/providers", "/mcp", "/settings"] as const;

// Google's "good" thresholds are LCP < 2500ms and CLS < 0.1. On loopback with
// no network latency we should be far under, so these are tight.
const BUDGET = { lcp: 1500, cls: 0.1, ttfb: 200 };

test.describe("core web vitals", () => {
    for (const route of ROUTES) {
        test(`${route} loads within budget`, async ({ authedPage: page }) => {
            const v = await measureVitals(page, route);

            recordMetric({
                group: "web-vitals",
                name: route,
                values: {
                    ttfb_ms: Math.round(v.ttfb),
                    fcp_ms: Math.round(v.fcp),
                    lcp_ms: Math.round(v.lcp),
                    cls: Number(v.cls.toFixed(4)),
                    dcl_ms: Math.round(v.domContentLoaded),
                    long_tasks: v.longTasks,
                    long_task_ms: Math.round(v.longTaskTime),
                },
            });

            expect.soft(v.ttfb, `${route} TTFB`).toBeLessThan(BUDGET.ttfb);
            expect(v.lcp, `${route} LCP`).toBeLessThan(BUDGET.lcp);
            expect(v.cls, `${route} CLS (layout stability)`).toBeLessThan(BUDGET.cls);
        });
    }
});
