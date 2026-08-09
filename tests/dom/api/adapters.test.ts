import { describe, expect, it } from "vitest";
import { adapters } from "@/lib/api/adapters";
import { installFetchMock, okJson } from "./test-helpers";

// `adapters` is a bare `defineResource` with no custom endpoints — the
// factory itself is exhaustively tested in resource.test.ts, so this file
// just pins the wiring (path/key/listShape/staleTime) is what callers expect.
describe("lib/api/adapters", () => {
    it("is wired to /adapters with key 'adapters' and array listShape", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "openai", label: "OpenAI" }]));
        const data = await adapters.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/adapters");
        expect(data).toEqual([{ id: "openai", label: "OpenAI" }]);
        expect(adapters.keys.all()).toEqual(["adapters"]);
    });

    it("get(id) hits /adapters/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "openai", label: "OpenAI" }));
        await adapters.get("openai");
        expect(fetchMock.mock.calls[0][0]).toBe("/api/adapters/openai");
    });
});
