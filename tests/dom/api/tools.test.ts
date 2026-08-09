import { describe, expect, it } from "vitest";
import { tools } from "@/lib/api/tools";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/tools", () => {
    it("is wired to /tools with key 'tools' and array listShape", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "search" }]));
        await tools.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/tools");
        expect(tools.keys.all()).toEqual(["tools"]);
    });

    it("create() POSTs to /tools", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "search" }));
        await tools.create({ name: "search" } as never);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/tools");
        expect(init.method).toBe("POST");
    });

    it("update() PATCHes /tools/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "renamed" }));
        await tools.update("1", { name: "renamed" } as never);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/tools/1");
        expect(init.method).toBe("PATCH");
    });

    it("remove() DELETEs /tools/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await tools.remove("1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/tools/1");
        expect(init.method).toBe("DELETE");
    });
});
