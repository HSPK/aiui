// Shared test utilities for tests/dom/playground-chat/** coverage.
// NOT a test file itself (no `.test.` in the name) so vitest's
// `include: ["tests/dom/**/*.test.{ts,tsx}"]` glob skips it.
//
// Mirrors the conventions in tests/dom/playground/_render.tsx and
// tests/dom/pages/_helpers.tsx (read-only references — this file is a
// fresh, self-contained copy per the "only create files under
// tests/dom/playground-chat/" rule).
import * as React from "react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, type RenderOptions, type RenderResult } from "@testing-library/react";

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

/** Shape-compatible stand-in for `useQuery`'s return value. Pass only
 *  the fields a given test cares about via `overrides`. */
export function queryResult<T>(
    overrides: Partial<{
        data: T | undefined;
        isLoading: boolean;
        isFetching: boolean;
        isPending: boolean;
        isError: boolean;
        isSuccess: boolean;
        error: Error | null;
        refetch: () => void;
    }> = {}
) {
    return {
        data: undefined as T | undefined,
        isLoading: false,
        isFetching: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null as Error | null,
        refetch: vi.fn(),
        ...overrides,
    };
}

/** Shape-compatible stand-in for `useMutation`'s return value. */
export function mutationResult<TData, TVars = unknown>(
    overrides: Partial<{
        mutate: (vars: TVars) => void;
        mutateAsync: (vars: TVars) => Promise<TData>;
        isPending: boolean;
        isError: boolean;
        isSuccess: boolean;
        error: Error | null;
        data: TData | undefined;
        reset: () => void;
    }> = {}
) {
    return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
        isError: false,
        isSuccess: false,
        error: null as Error | null,
        data: undefined as TData | undefined,
        reset: vi.fn(),
        ...overrides,
    };
}

/** Minimal `next/navigation` router double. Spread-override per test. */
export function makeRouter(overrides: Partial<{
    push: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    back: ReturnType<typeof vi.fn>;
    forward: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    prefetch: ReturnType<typeof vi.fn>;
}> = {}) {
    return {
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        refresh: vi.fn(),
        prefetch: vi.fn(),
        ...overrides,
    };
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
// Each reset calls RTL's `cleanup()` first. Vitest runs a test file's own
// top-level `afterEach` hooks BEFORE the auto-cleanup `afterEach`
// registered by tests/setup/dom.ts (verified empirically), so a component
// rendered in the test we're cleaning up after is often still mounted and
// subscribed when this runs. Resetting values that actually changed would
// then notify that live subscriber outside of `act()`, producing a
// "not wrapped in act(...)" warning. `cleanup()` is idempotent — safe to
// call again from the global afterEach afterward.
//
// Call the relevant reset(s) in `afterEach` in any test file that renders
// a component/hook touching these stores.
const initialPlaygroundState = usePlaygroundStore.getState();
const initialModalityState = useModalityStore.getState();
const initialDeviceSettingsState = useDeviceSettingsStore.getState();

export function resetPlaygroundStore(): void {
    cleanup();
    usePlaygroundStore.setState(initialPlaygroundState, true);
}

export function resetModalityStore(): void {
    cleanup();
    useModalityStore.setState(initialModalityState, true);
}

export function resetDeviceSettingsStore(): void {
    cleanup();
    useDeviceSettingsStore.setState(initialDeviceSettingsState, true);
}

/** Resets all three real playground Zustand stores. Also clears
 *  `localStorage` since `persist` mirrors state there on every write. */
export function resetPlaygroundStores(): void {
    cleanup();
    usePlaygroundStore.setState(initialPlaygroundState, true);
    useModalityStore.setState(initialModalityState, true);
    useDeviceSettingsStore.setState(initialDeviceSettingsState, true);
    localStorage.clear();
}
