// Shared test utilities for tests/dom/playground-model/**. NOT a test file
// itself (no `.test.` in the name) so vitest's
// `include: ["tests/dom/**/*.test.{ts,tsx}"]` glob skips it. Mirrors the
// conventions in tests/dom/playground/_render.tsx and tests/dom/admin/_render.tsx
// but lives locally per the "only create files under
// tests/dom/playground-model/" rule for this assignment.
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";

import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { useModalityStore } from "@/lib/stores/modality-store";

/** Fresh QueryClient with retries disabled — deterministic, fast failures. */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
}

/** `Wrapper` + `queryClient` pair for `renderHook(fn, { wrapper })`. */
export function createQueryWrapper(queryClient: QueryClient = createTestQueryClient()) {
    function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { Wrapper, queryClient };
}

/** Renders `ui` inside a fresh `QueryClientProvider`. Returns the RTL
 *  result plus the `queryClient` instance in case a test wants to
 *  inspect/prime the cache directly. */
export function renderWithClient(
    ui: React.ReactElement,
    options?: RenderOptions & { queryClient?: QueryClient }
): RenderResult & { queryClient: QueryClient } {
    const { queryClient = createTestQueryClient(), ...rest } = options ?? {};
    const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, rest);
    return { ...result, queryClient };
}

/** Waits a macrotask so pending microtask chains (fetch mocks, effects,
 *  React Query's internal scheduling) settle. */
export function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Zustand store resets.
//
// Both stores are REAL (not mocked) per the assignment — they are
// `zustand/middleware persist` singletons created once at module import
// time, so mutations in one `it()` leak into the next unless reset. Each
// snapshot below is captured the first time this module is imported
// (before any test mutates state), including the action closures, so
// `setState(initial, true)` (full replace) restores both data *and*
// actions identically.
//
// Call the relevant reset(s) in `afterEach` in any test file that renders
// a component/hook touching these stores.
const initialPlaygroundState = usePlaygroundStore.getState();
const initialModalityState = useModalityStore.getState();

export function resetPlaygroundStore(): void {
    usePlaygroundStore.setState(initialPlaygroundState, true);
}

export function resetModalityStore(): void {
    useModalityStore.setState(initialModalityState, true);
}

/** Resets both real playground Zustand stores. Also clears `localStorage`
 *  since `persist` mirrors state there on every write. */
export function resetPlaygroundStores(): void {
    resetPlaygroundStore();
    resetModalityStore();
    localStorage.clear();
}
