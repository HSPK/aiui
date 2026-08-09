// Shared render helper for tests/dom/admin/**. NOT a test file itself (no
// `.test.` in the name) so vitest's `include: ["tests/dom/**/*.test.{ts,tsx}"]`
// glob skips it. Mirrors the conventions in tests/dom/api/test-helpers.ts but
// lives locally per the "only create files under tests/dom/admin/" rule.
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";

/** Fresh, isolated QueryClient per test — no retries (fast, deterministic
 *  failures), no background refetch noise.
 *
 *  Deliberately does NOT set `gcTime: 0` (and matches production's
 *  `AppProviders.tsx`, which also leaves it at the library default):
 *  a query with zero observers and `gcTime: 0` schedules its own removal
 *  via a real `setTimeout(fn, 0)`. Any test that calls `setQueryData`
 *  directly (rather than through a mounted, subscribed `useQuery`) creates
 *  exactly such an unobserved query, so a `gcTime: 0` client silently
 *  evicts it the instant the test yields to a real macrotask (e.g. via
 *  `waitFor`), independent of any `queryClient.clear()` under test. Each
 *  test already gets a brand-new client instance, so GC speed buys no
 *  extra isolation — only flakiness. */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
}

/** Renders `ui` inside a fresh QueryClientProvider. Returns the RTL render
 *  result plus the QueryClient instance (for cache assertions). */
export function renderWithQuery(
    ui: React.ReactElement,
    opts?: { queryClient?: QueryClient } & Omit<RenderOptions, "wrapper">,
) {
    const queryClient = opts?.queryClient ?? createTestQueryClient();
    function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const view = render(ui, { wrapper: Wrapper, ...opts });
    return { queryClient, ...view };
}

/** Waits a macrotask so pending microtask chains (dynamic imports, fetch
 *  mocks, effects) settle. Useful for `next/dynamic` (log-details-lazy,
 *  react-json-view) which resolves on a real microtask/macrotask boundary
 *  even under vitest's synchronous module graph. */
export function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
