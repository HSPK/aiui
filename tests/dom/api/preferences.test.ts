import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preferences } from "@/lib/api/preferences";
import { defaultUserPreferences } from "@/lib/schemas/preferences";
import { createQueryWrapper, installFetchMock, okJson } from "./test-helpers";

describe("lib/api/preferences", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("keys.all() is a stable ['preferences'] tuple", () => {
        expect(preferences.keys.all()).toEqual(["preferences"]);
    });

    it("get() GETs /users/me/preferences", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(defaultUserPreferences));
        const data = await preferences.get();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users/me/preferences");
        expect(init.method).toBeUndefined();
        expect(data).toEqual(defaultUserPreferences);
    });

    it("update() PATCHes /users/me/preferences with the partial patch", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ ...defaultUserPreferences, user_name: "Ann" }));
        const data = await preferences.update({ user_name: "Ann" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users/me/preferences");
        expect(init.method).toBe("PATCH");
        expect(init.body).toBe(JSON.stringify({ user_name: "Ann" }));
        expect(data.user_name).toBe("Ann");
    });

    describe("useGet", () => {
        it("fetches preferences on mount", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(defaultUserPreferences));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => preferences.useGet(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/users/me/preferences");
            expect(result.current.data).toEqual(defaultUserPreferences);
        });

        it("invalidates its cache when a peer tab broadcasts an update", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValue(okJson(defaultUserPreferences));
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

            const { result, unmount } = renderHook(() => preferences.useGet(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            invalidateSpy.mockClear();

            const peer = new BroadcastChannel("loom-preferences");
            try {
                peer.postMessage({ kind: "update" });
                await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["preferences"] }));
            } finally {
                peer.close();
                unmount();
            }
        });

        it("ignores broadcast messages that aren't the update kind", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValue(okJson(defaultUserPreferences));
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

            const { result, unmount } = renderHook(() => preferences.useGet(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            invalidateSpy.mockClear();

            const peer = new BroadcastChannel("loom-preferences");
            try {
                // Deliberately malformed to exercise the `!== "update"` guard
                // (BroadcastChannel.postMessage's parameter type is `any`, so
                // this is a runtime-only concern, not a compile-time one).
                peer.postMessage({ kind: "noop" });
                // Post a real "update" afterwards so we have a deterministic
                // signal to wait on; if the noop message had wrongly
                // triggered an invalidation we'd see 2 calls, not 1.
                peer.postMessage({ kind: "update" });
                await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));
                expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["preferences"] });
            } finally {
                peer.close();
                unmount();
            }
        });

        it("does not throw and skips the subscription when BroadcastChannel is unavailable (SSR-safe guard)", async () => {
            vi.stubGlobal("BroadcastChannel", undefined);
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(defaultUserPreferences));
            const { Wrapper } = createQueryWrapper();
            const { result, unmount } = renderHook(() => preferences.useGet(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(() => unmount()).not.toThrow();
        });
    });

    describe("useUpdate", () => {
        it("invalidates the preferences cache and broadcasts to peer tabs on success", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ ...defaultUserPreferences, user_name: "Ann" }));
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

            const received: unknown[] = [];
            const peer = new BroadcastChannel("loom-preferences");
            peer.onmessage = (e) => received.push(e.data);

            const { result } = renderHook(() => preferences.useUpdate(), { wrapper: Wrapper });
            try {
                await act(async () => {
                    await result.current.mutateAsync({ user_name: "Ann" });
                });
                expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["preferences"] });
                await waitFor(() => expect(received).toEqual([{ kind: "update" }]));
            } finally {
                peer.close();
            }
        });

        it("still invalidates locally (without throwing) when BroadcastChannel is unavailable", async () => {
            vi.stubGlobal("BroadcastChannel", undefined);
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ ...defaultUserPreferences, user_name: "Ann" }));
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

            const { result } = renderHook(() => preferences.useUpdate(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync({ user_name: "Ann" });
            });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["preferences"] });
        });
    });
});
