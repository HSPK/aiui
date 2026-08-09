import { describe, expect, it } from "vitest";
import { logs } from "@/lib/api/logs";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/logs", () => {
    it("is wired to /logs/generations with key 'logs'", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 20 }));
        await logs.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/logs/generations");
        expect(logs.keys.all()).toEqual(["logs"]);
    });

    it("list(query) forwards LogFilterParams as URL params", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 20 }));
        await logs.list({ status: "failed", model_name: "gpt-4" });
        expect(fetchMock.mock.calls[0][0]).toBe(
            "/api/logs/generations?status=failed&model_name=gpt-4"
        );
    });

    it("get(id) hits GET /logs/generations/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", capability: "chat" }));
        await logs.get("1");
        expect(fetchMock.mock.calls[0][0]).toBe("/api/logs/generations/1");
    });
});
