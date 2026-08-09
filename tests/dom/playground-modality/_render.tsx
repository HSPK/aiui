// Shared test utilities for tests/dom/playground-modality/**. NOT a test
// file itself (no `.test.` in the name) so vitest's
// `include: ["tests/dom/**/*.test.{ts,tsx}"]` glob skips it. Mirrors the
// conventions in tests/dom/playground-model/_render.tsx but is duplicated
// locally per the "only create files under tests/dom/playground-modality/"
// rule for this assignment — the two components under test here
// (ModalitySingleModelSelector / ModalityMultiModelSelector) don't touch
// any Zustand store, so no store-reset helpers are needed.
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";

/** Fresh QueryClient with retries disabled — deterministic, fast failures. */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
}

/** Renders `ui` inside a fresh `QueryClientProvider`. Returns the RTL
 *  result plus the `queryClient` instance so a test can `rerender` inside
 *  the same provider (e.g. to simulate a background refetch flipping
 *  `isLoading`). */
export function renderWithClient(
    ui: React.ReactElement,
    options?: RenderOptions & { queryClient?: QueryClient }
): RenderResult & { queryClient: QueryClient } {
    const { queryClient = createTestQueryClient(), ...rest } = options ?? {};
    const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, rest);
    return { ...result, queryClient };
}
