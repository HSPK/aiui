import { defineConfig, devices } from "@playwright/test";

// Loom's browser-level suite. Two projects:
//
//   e2e   — functional smoke over the real UI
//   perf  — responsiveness benchmarks (Core Web Vitals, INP under streaming,
//           transferred-bytes budgets). Run serially with one worker so
//           timing numbers aren't polluted by parallel CPU contention.
//
// The webServer boots the real production build against a throwaway SQLite
// file plus a fake OpenAI-compatible upstream, so streaming is exercised end
// to end without network flakiness.

const PORT = Number(process.env.LOOM_E2E_PORT || 3311);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: "./e2e",
    globalSetup: "./e2e/support/global-setup.ts",
    outputDir: "./e2e/.artifacts",
    fullyParallel: false,
    // One app server and one SQLite file back the whole suite, so parallel
    // workers contend on shared state and surface as spurious timeouts.
    // Correctness of the measurements matters more here than wall-clock.
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [["list"], ["json", { outputFile: "e2e/.artifacts/report.json" }]]
        : [["list"]],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: BASE_URL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
    },
    projects: [
        {
            name: "e2e",
            testMatch: /e2e\/specs\/.*\.spec\.ts/,
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "experience",
            testMatch: /e2e\/experience\/.*\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
        },
        {
            name: "perf",
            testMatch: /e2e\/perf\/.*\.spec\.ts/,
            fullyParallel: false,
            workers: 1,
            use: {
                ...devices["Desktop Chrome"],
                // Deterministic viewport so layout-shift numbers are comparable
                // between runs.
                viewport: { width: 1440, height: 900 },
            },
        },
    ],
    webServer: {
        command: "node e2e/support/boot.mjs",
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
