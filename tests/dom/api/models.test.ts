import { describe, expect, it } from "vitest";
import { models } from "@/lib/api/models";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/models", () => {
    it("is wired to /models with key 'models', array listShape, and invalidates providers", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "gpt-4" }]));
        await models.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/models");
        expect(models.keys.all()).toEqual(["models"]);
    });

    it("create() POSTs to /models", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "gpt-4" }));
        await models.create({ name: "gpt-4" } as never);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/models");
        expect(init.method).toBe("POST");
    });

    it("update() PATCHes /models/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "renamed" }));
        await models.update("1", { name: "renamed" } as never);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/models/1");
        expect(init.method).toBe("PATCH");
    });

    it("remove() DELETEs /models/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await models.remove("1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/models/1");
        expect(init.method).toBe("DELETE");
    });
});
