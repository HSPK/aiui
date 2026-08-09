import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiKeys } from "@/lib/api/apikeys";
import { createQueryWrapper, installFetchMock, okJson } from "./test-helpers";

describe("lib/api/apikeys", () => {
    it("is wired to /apikeys with key 'apikeys' and array listShape", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "ci", prefix: "sk-abc" }]));
        await apiKeys.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/apikeys");
        expect(apiKeys.keys.all()).toEqual(["apikeys"]);
    });

    it("remove() DELETEs /apikeys/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await apiKeys.remove("1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/apikeys/1");
        expect(init.method).toBe("DELETE");
    });

    it("create() POSTs to /apikeys and returns the one-time plaintext key", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            okJson({ id: "1", name: "ci", prefix: "sk-abc", key: "sk-abcdef123456" })
        );
        const created = await apiKeys.create({ name: "ci" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/apikeys");
        expect(init.method).toBe("POST");
        expect(init.body).toBe(JSON.stringify({ name: "ci" }));
        expect(created.key).toBe("sk-abcdef123456");
    });

    it("useCreate() invalidates the apikeys cache and forwards the created key on success", async () => {
        const { Wrapper, queryClient } = createQueryWrapper();
        const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            okJson({ id: "1", name: "ci", prefix: "sk-abc", key: "sk-abcdef123456" })
        );
        const onSuccess = vi.fn();

        const { result } = renderHook(() => apiKeys.useCreate({ onSuccess }), { wrapper: Wrapper });
        await act(async () => {
            await result.current.mutateAsync({ name: "ci" });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["apikeys"] });
        expect(onSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ key: "sk-abcdef123456" }),
            { name: "ci" },
            undefined,
            expect.anything(),
        );
    });
});
