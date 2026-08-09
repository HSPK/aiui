// Shared TanStack Query hook-result builder for tests/dom/playground-modality/**.
// NOT a test file itself. Mirrors tests/dom/playground-model/_mocks.ts
// conventions — see that file for full rationale. Kept as a local copy per
// the "only create files under tests/dom/playground-modality/" rule.
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
