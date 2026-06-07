"use client";
import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationOptions,
    type UseQueryOptions,
} from "@tanstack/react-query";
import { fetcher, withQuery } from "./client";

/**
 * defineResource — derives the api functions + hooks + query keys for a
 * CRUD resource from one descriptor.
 *
 * Adding a standard CRUD endpoint to the FE is now a zero-line change:
 *
 *   export const users = defineResource<UserDTO, UserCreateInput, UserUpdateInput, UserFilterParams>({
 *       path: "/users",
 *       key: "users",
 *   });
 *
 *   // Consumers:
 *   await users.list();           await users.create(data);
 *   users.useList(filters);       users.useCreate();
 *   users.useGet(id);             users.useUpdate();
 *                                 users.useDelete();
 *
 * Extending with non-CRUD endpoints (custom paths, special methods) is
 * an object spread:
 *
 *   export const providers = {
 *       ...defineResource<ProviderDTO, ProviderCreateInput, ProviderUpdateInput>({
 *           path: "/providers",
 *           key: "providers",
 *           listShape: "array",
 *       }),
 *       reload: () => fetcher<null>("/providers/reload", { method: "POST" }),
 *       useModels: (id: string | undefined) => useQuery({ ... }),
 *   };
 *
 * The factory owns:
 *   - URL construction (path + encodeURIComponent on ids)
 *   - HTTP verbs (POST create / PATCH update / DELETE remove)
 *   - Query key shape (["<key>"] / ["<key>", "list", q] / ["<key>", id])
 *   - Cache invalidation on mutation success
 *   - placeholderData (keep previous on list) + enabled (gate get on id)
 */

export interface ResourceConfig<TQuery> {
    /** URL path under API_BASE, e.g. "/providers". */
    path: string;
    /** Query key root, e.g. "providers" (becomes `["providers"]`). */
    key: string;
    /** "paginated" → Paginated<T>; "array" → T[]. Default "paginated". */
    listShape?: "paginated" | "array";
    /** Stable id encoder. Default encodeURIComponent. */
    encode?: (id: string) => string;
    /** Stale time (ms) applied to useList/useGet. */
    staleTime?: number;
    /** Whether useList keeps previous data while refetching. Default true. */
    keepPrev?: boolean;
    /**
     * Default invalidator. Override to invalidate additional keys
     * (e.g. when mutating providers also invalidate models).
     */
    invalidates?: readonly string[];
    /** Project filters into URL params. Default: pass through. */
    paramsOf?: (query: TQuery) => Record<string, unknown>;
    /** Type tag — never used at runtime, only carries TQuery through inference. */
    _query?: TQuery;
}

export function defineResource<
    TDTO,
    TCreate = TDTO,
    TUpdate = Partial<TCreate>,
    TQuery = Record<string, unknown>,
    TListResult = unknown,
>(cfg: ResourceConfig<TQuery>) {
    const enc = cfg.encode ?? encodeURIComponent;
    const project = cfg.paramsOf ?? ((q: TQuery) => q as unknown as Record<string, unknown>);
    const keepPrev = cfg.keepPrev !== false;

    // ---- raw fetch functions ----
    const list = (query: TQuery = {} as TQuery): Promise<TListResult> =>
        fetcher<TListResult>(withQuery(cfg.path, project(query) as Record<string, string | number | boolean | undefined | null>));
    const get = (id: string): Promise<TDTO> =>
        fetcher<TDTO>(`${cfg.path}/${enc(id)}`);
    const create = (data: TCreate): Promise<TDTO> =>
        fetcher<TDTO>(cfg.path, { method: "POST", body: JSON.stringify(data) });
    const update = (id: string, data: TUpdate): Promise<TDTO | null> =>
        fetcher<TDTO | null>(`${cfg.path}/${enc(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    const remove = (id: string): Promise<null> =>
        fetcher<null>(`${cfg.path}/${enc(id)}`, { method: "DELETE" });

    // ---- query keys ----
    const keys = {
        all: () => [cfg.key] as const,
        list: (query?: TQuery) => [cfg.key, "list", project(query ?? ({} as TQuery))] as const,
        one: (id: string) => [cfg.key, id] as const,
    };

    // ---- shared invalidation ----
    const useInvalidate = () => {
        const qc = useQueryClient();
        return () => {
            qc.invalidateQueries({ queryKey: keys.all() });
            for (const extra of cfg.invalidates ?? []) {
                qc.invalidateQueries({ queryKey: [extra] });
            }
        };
    };

    // ---- hooks ----
    const useList = (
        query: TQuery = {} as TQuery,
        opts?: Omit<UseQueryOptions<TListResult>, "queryKey" | "queryFn">,
    ) => useQuery<TListResult>({
        queryKey: keys.list(query) as unknown as readonly unknown[],
        queryFn: () => list(query),
        ...(keepPrev ? { placeholderData: ((prev: TListResult | undefined) => prev) as never } : {}),
        ...(cfg.staleTime != null ? { staleTime: cfg.staleTime } : {}),
        ...opts,
    });

    const useGet = (
        id: string | null | undefined,
        opts?: Omit<UseQueryOptions<TDTO>, "queryKey" | "queryFn">,
    ) => useQuery<TDTO>({
        queryKey: keys.one(id ?? "") as unknown as readonly unknown[],
        queryFn: () => get(id!),
        enabled: !!id,
        ...(cfg.staleTime != null ? { staleTime: cfg.staleTime } : {}),
        ...opts,
    });

    const useCreate = (
        opts?: Omit<UseMutationOptions<TDTO, Error, TCreate>, "mutationFn">,
    ) => {
        const invalidate = useInvalidate();
        return useMutation<TDTO, Error, TCreate>({
            mutationFn: create,
            ...opts,
            onSuccess: (...args) => {
                invalidate();
                opts?.onSuccess?.(...args);
            },
        });
    };

    const useUpdate = (
        opts?: Omit<UseMutationOptions<TDTO | null, Error, { id: string; data: TUpdate }>, "mutationFn">,
    ) => {
        const invalidate = useInvalidate();
        return useMutation<TDTO | null, Error, { id: string; data: TUpdate }>({
            mutationFn: ({ id, data }) => update(id, data),
            ...opts,
            onSuccess: (...args) => {
                invalidate();
                opts?.onSuccess?.(...args);
            },
        });
    };

    const useDelete = (
        opts?: Omit<UseMutationOptions<null, Error, string>, "mutationFn">,
    ) => {
        const invalidate = useInvalidate();
        return useMutation<null, Error, string>({
            mutationFn: remove,
            ...opts,
            onSuccess: (...args) => {
                invalidate();
                opts?.onSuccess?.(...args);
            },
        });
    };

    return {
        // raw fetch
        list,
        get,
        create,
        update,
        remove,
        // hooks
        useList,
        useGet,
        useCreate,
        useUpdate,
        useDelete,
        useInvalidate,
        // keys
        keys,
    };
}
