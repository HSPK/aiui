// Shared test utilities for components/playground/** coverage.
// NOT a test file itself (no `.test.` in the name) so vitest's
// `include: ["tests/dom/**/*.test.{ts,tsx}"]` glob skips it.
//
// Import from sibling test files as:
//   import { renderWithClient, createQueryWrapper, resetPlaygroundStores } from "../_render";
import * as React from "react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";

import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { useModalityStore } from "@/lib/stores/modality-store";
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store";

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

/** Builds a `Response` whose body streams the given string chunks
 *  (SSE-style, one enqueue per chunk) — for `stream-client`/`fetch`
 *  mocking. */
export function sseResponse(
    chunks: string[],
    init: { status?: number; headers?: Record<string, string>; statusText?: string } = {}
): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
    return new Response(stream, {
        status: init.status ?? 200,
        statusText: init.statusText,
        headers: init.headers,
    });
}

/** Installs `global.fetch` as a fresh `vi.fn()` and returns it for assertions. */
export function installFetchMock(): ReturnType<typeof vi.fn> {
    const fn = vi.fn();
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}

/** Waits a macrotask so pending microtask chains (fetch mocks, effects) settle. */
export function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Zustand store resets.
//
// These three stores are REAL (not mocked) per the assignment — they are
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
const initialDeviceSettingsState = useDeviceSettingsStore.getState();

export function resetPlaygroundStore(): void {
    usePlaygroundStore.setState(initialPlaygroundState, true);
}

export function resetModalityStore(): void {
    useModalityStore.setState(initialModalityState, true);
}

export function resetDeviceSettingsStore(): void {
    useDeviceSettingsStore.setState(initialDeviceSettingsState, true);
}

/** Resets all three real playground Zustand stores. Also clears
 *  `localStorage` since `persist` mirrors state there on every write. */
export function resetPlaygroundStores(): void {
    resetPlaygroundStore();
    resetModalityStore();
    resetDeviceSettingsStore();
    localStorage.clear();
}
