import { describe, expect, it } from "vitest";
import { capabilities } from "@/lib/api/capabilities";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/capabilities", () => {
    it("is wired to /capabilities with key 'capabilities' and array listShape", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "chat", label: "Chat", description: null, default_variant: "chat.completions" }]));
        const data = await capabilities.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/capabilities");
        expect(data).toEqual([{ id: "chat", label: "Chat", description: null, default_variant: "chat.completions" }]);
        expect(capabilities.keys.all()).toEqual(["capabilities"]);
    });
});
