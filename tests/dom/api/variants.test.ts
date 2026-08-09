import { describe, expect, it } from "vitest";
import { variants } from "@/lib/api/variants";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/variants", () => {
    it("is wired to /variants with key 'variants' and array listShape", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "chat.completions", capability: "chat", label: "Chat Completions" }]));
        const data = await variants.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/variants");
        expect(data).toEqual([{ id: "chat.completions", capability: "chat", label: "Chat Completions" }]);
        expect(variants.keys.all()).toEqual(["variants"]);
    });
});
