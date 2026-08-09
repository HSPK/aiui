// Shared TanStack Query hook-result builders for tests/dom/playground-model/**.
// NOT a test file itself. Mirrors tests/dom/admin/_mocks.ts conventions —
// see that file for full rationale. Kept as a local copy per the
// "only create files under tests/dom/playground-model/" rule.
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
 *  "loaded successfully with `data`" state. Return type is deliberately
 *  `any` — the real `UseQueryResult` union has many more fields these
 *  components never read. */
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
 *  mutation fired with what payload". */
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

interface InfiniteQueryLike<T> {
    data: { pages: T[]; pageParams: unknown[] } | undefined;
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isLoading: boolean;
}

/** Builds a minimal `useInfiniteQuery` result — used for
 *  `conversations.useInfinite`. `pages` is passed pre-built (one entry
 *  per "page" of the paginated shape the sidebar flattens via
 *  `data?.pages.flatMap((page) => page?.items || [])`). */
export function makeInfiniteQuery<T>(overrides: Partial<InfiniteQueryLike<T>> = {}): any {
    const result: InfiniteQueryLike<T> = {
        data: { pages: [], pageParams: [1] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        ...overrides,
    };
    return result;
}
