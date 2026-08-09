import type { Page } from "@playwright/test";

/** Bytes actually transferred per resource type for one navigation. */
export interface TransferReport {
    js: number;
    css: number;
    total: number;
    requests: number;
    files: string[];
}

/** Records real transfer sizes (post-compression) via the CDP-backed
 *  `encodedBodySize`, which is what a user's connection actually pays for. */
export async function measureTransfer(page: Page, path: string): Promise<TransferReport> {
    await page.goto(path, { waitUntil: "networkidle" }).catch(async () => {
        await page.goto(path, { waitUntil: "domcontentloaded" });
    });
    return page.evaluate(() => {
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const report = { js: 0, css: 0, total: 0, requests: 0, files: [] as string[] };
        for (const e of entries) {
            const size = e.encodedBodySize || 0;
            report.total += size;
            report.requests += 1;
            if (e.name.endsWith(".js") || e.initiatorType === "script") {
                report.js += size;
                if (size > 0) report.files.push(`${Math.round(size / 1024)}KB ${e.name.split("/").pop()}`);
            } else if (e.name.endsWith(".css")) {
                report.css += size;
            }
        }
        report.files.sort((a, b) => parseInt(b) - parseInt(a));
        return report;
    });
}

export interface VitalsReport {
    ttfb: number;
    fcp: number;
    lcp: number;
    cls: number;
    domContentLoaded: number;
    load: number;
    longTasks: number;
    longTaskTime: number;
}

/** Core Web Vitals for a cold navigation. LCP and CLS are only final once the
 *  page settles, so callers should let it idle before reading. */
export async function measureVitals(page: Page, path: string): Promise<VitalsReport> {
    // Install the observers before anything navigates, otherwise the entries
    // for this navigation are already gone.
    await page.addInitScript(() => {
        const w = window as unknown as { __vitals: { lcp: number; cls: number; longTasks: number; longTaskTime: number } };
        w.__vitals = { lcp: 0, cls: 0, longTasks: 0, longTaskTime: 0 };
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) w.__vitals.lcp = e.startTime;
            }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch { /* unsupported */ }
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    const s = e as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
                    if (!s.hadRecentInput) w.__vitals.cls += s.value ?? 0;
                }
            }).observe({ type: "layout-shift", buffered: true });
        } catch { /* unsupported */ }
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    w.__vitals.longTasks += 1;
                    w.__vitals.longTaskTime += e.duration;
                }
            }).observe({ type: "longtask", buffered: true });
        } catch { /* unsupported */ }
    });

    await page.goto(path, { waitUntil: "networkidle" }).catch(async () => {
        await page.goto(path, { waitUntil: "domcontentloaded" });
    });
    // Give LCP/CLS a moment to stabilise after the last paint.
    await page.waitForTimeout(600);

    return page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
        const v = (window as unknown as { __vitals: { lcp: number; cls: number; longTasks: number; longTaskTime: number } }).__vitals;
        return {
            ttfb: nav ? nav.responseStart - nav.requestStart : 0,
            fcp,
            lcp: v.lcp || fcp,
            cls: v.cls,
            domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
            load: nav ? nav.loadEventEnd - nav.startTime : 0,
            longTasks: v.longTasks,
            longTaskTime: v.longTaskTime,
        };
    });
}

/** Pretty one-line summary for the console/report. */
export function fmtBytes(n: number): string {
    return `${(n / 1024).toFixed(0)} KB`;
}
