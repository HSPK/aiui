// Shared TanStack Query hook-result builders for tests/dom/admin/**. NOT a
// test file itself. Use these to build the return value of `vi.mocked(...)
// .mockReturnValue(...)` when a test mocks a `@/lib/api/*` domain module
// hook (useList/useGet/useCreate/useUpdate/useDelete/custom hooks) — the
// components under test only read a handful of fields off the real
// UseQueryResult/UseMutationResult shape, so a small literal object is both
// simpler and more deterministic than driving a real network round-trip.
//
// IMPORTANT: `tests/setup/dom.ts` calls `vi.clearAllMocks()` in `afterEach`,
// which clears call history but NOT a previously-`mockReturnValue`d
// implementation. Every test must set the mock's return value itself
// (don't rely on a value left over from a previous test in the same file).
import { vi } from "vitest";

interface QueryLike<T> {
    data: T | undefined;
    isLoading: boolean;
    isFetching: boolean;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: Error | null;
    refetch: () => void;
}

/** Builds a minimal UseQueryResult-shaped object. Defaults to the
 *  "loaded successfully with `data`" state.
 *
 *  Return type is deliberately `any`: the real `UseQueryResult` union has many
 *  more fields (`fetchStatus`, `isLoadingError`, `promise`, ...) that these
 *  components never read. Declaring `any` lets `mockReturnValue`/
 *  `mockImplementation` accept this object everywhere without a per-call-site
 *  cast, while the object literal below is still checked against `QueryLike<T>`. */
export function makeQuery<T>(overrides: Partial<QueryLike<T>> & { data?: T } = {}): any {
    const hasData = overrides.data !== undefined;
    const result: QueryLike<T> = {
        data: undefined,
        isLoading: !hasData,
        isFetching: false,
        isPending: !hasData,
        isError: false,
        isSuccess: hasData,
        error: null,
        refetch: vi.fn(),
        ...overrides,
    };
    return result;
}

interface MutationLike<TData, TVars> {
    mutate: (vars: TVars, opts?: { onSuccess?: (data: TData) => void; onError?: (err: Error) => void }) => void;
    mutateAsync: (vars: TVars) => Promise<TData>;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: Error | null;
    data: TData | undefined;
    reset: () => void;
    status: "idle" | "pending" | "error" | "success";
}

/** Builds a minimal UseMutationResult-shaped object, idle by default.
 *  `mutate`/`mutateAsync` are spies — assert `.mock.calls` for "which
 *  mutation fired with what payload".
 *
 *  Return type is deliberately `any` (see `makeQuery` above for rationale):
 *  the real `UseMutationResult` requires many more fields
 *  (`submittedAt`, `variables`, `failureCount`, `context`, ...) that these
 *  components never read. */
export function makeMutation<TData = unknown, TVars = unknown>(
    overrides: Partial<MutationLike<TData, TVars>> = {},
): any {
    const result: MutationLike<TData, TVars> = {
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue(undefined as unknown as TData),
        isPending: false,
        isError: false,
        isSuccess: false,
        error: null,
        data: undefined,
        reset: vi.fn(),
        status: "idle",
        ...overrides,
    };
    return result;
}

/** Shape returned by `mcpServers.useCheck` / `providers.useCheckMany`
 *  (per-row pending Set instead of a single scalar `isPending`). Return type
 *  is deliberately `any` — see `makeQuery` above for rationale. */
export function makePendingSetMutation(overrides: {
    mutate?: (...args: unknown[]) => void;
    mutateAsync?: (...args: unknown[]) => Promise<unknown>;
    pendingIds?: string[];
} = {}): any {
    const pending = new Set(overrides.pendingIds ?? []);
    return {
        mutate: overrides.mutate ?? vi.fn(),
        mutateAsync: overrides.mutateAsync ?? vi.fn().mockResolvedValue(undefined),
        isPendingId: (id: string) => pending.has(id),
        anyPending: pending.size > 0,
        pendingCount: pending.size,
    };
}
