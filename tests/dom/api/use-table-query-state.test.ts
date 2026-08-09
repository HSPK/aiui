import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTableQueryState } from "@/lib/hooks/use-table-query-state";

describe("lib/hooks/use-table-query-state", () => {
    it("defaults to page 1, pageSize 20, sorted -created_at desc", () => {
        const { result } = renderHook(() => useTableQueryState());
        expect(result.current.page).toBe(1);
        expect(result.current.pageSize).toBe(20);
        expect(result.current.sorting).toEqual([{ id: "created_at", desc: true }]);
        expect(result.current.sort).toBe("-created_at");
    });

    it("honours defaultSortId/defaultDesc/defaultPageSize overrides", () => {
        const { result } = renderHook(() =>
            useTableQueryState({ defaultSortId: "name", defaultDesc: false, defaultPageSize: 50 }),
        );
        expect(result.current.pageSize).toBe(50);
        expect(result.current.sorting).toEqual([{ id: "name", desc: false }]);
        expect(result.current.sort).toBe("name");
    });

    it("setPageSize updates pageSize and resets page back to 1", () => {
        const { result } = renderHook(() => useTableQueryState());

        act(() => result.current.setPage(3));
        expect(result.current.page).toBe(3);

        act(() => result.current.setPageSize(100));
        expect(result.current.pageSize).toBe(100);
        expect(result.current.page).toBe(1);
    });

    it("setPage sets the page directly", () => {
        const { result } = renderHook(() => useTableQueryState());
        act(() => result.current.setPage(7));
        expect(result.current.page).toBe(7);
    });

    it("setSorting updates sorting and the derived sort string reflects desc/asc", () => {
        const { result } = renderHook(() => useTableQueryState());

        act(() => result.current.setSorting([{ id: "name", desc: false }]));
        expect(result.current.sort).toBe("name");

        act(() => result.current.setSorting([{ id: "email", desc: true }]));
        expect(result.current.sort).toBe("-email");
    });

    it("falls back to the default sort id/direction when sorting is emptied", () => {
        const { result } = renderHook(() => useTableQueryState({ defaultSortId: "created_at", defaultDesc: true }));

        act(() => result.current.setSorting([]));
        expect(result.current.sorting).toEqual([]);
        expect(result.current.sort).toBe("-created_at");
    });

    it("the empty-sorting fallback respects defaultDesc=false (no prefix)", () => {
        const { result } = renderHook(() => useTableQueryState({ defaultSortId: "name", defaultDesc: false }));

        act(() => result.current.setSorting([]));
        expect(result.current.sort).toBe("name");
    });
});
