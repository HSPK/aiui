// Shared (non-test) helpers for tests/dom/pages/**. Mirrors the role of
// tests/node/routes/_helpers.ts: reduce per-file boilerplate for
// rendering App Router page/layout components in isolation.
//
// NOT a test file — no `describe`/`it` here, so vitest's `dom` project
// glob (tests/dom/**/*.test.{ts,tsx}) never picks it up as its own suite.
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { UserDTO } from "@/lib/schemas/user";

/** Fresh, isolated QueryClient per test — no retries/caching bleed
 *  between tests, no delay waiting for retry backoff on induced errors. */
export function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
}

/** Render `ui` wrapped in a fresh QueryClientProvider. Returns the RTL
 *  utils plus the QueryClient (for cache seeding/inspection). */
export function renderWithClient(
    ui: React.ReactElement,
    queryClient: QueryClient = makeQueryClient(),
): RenderResult & { queryClient: QueryClient } {
    const utils = render(
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
    return { ...utils, queryClient };
}

export const adminUser: UserDTO = {
    username: "admin",
    role: "admin",
    created_at: "2024-01-01T00:00:00.000Z",
};

export const normalUser: UserDTO = {
    username: "alice",
    role: "user",
    created_at: "2024-01-02T00:00:00.000Z",
};

/** Shape-compatible stand-in for `useQuery`'s return value. Every page
 *  destructures a subset of these fields — pass only what a given test
 *  cares about via `overrides`. */
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
    }> = {},
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
    }> = {},
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
