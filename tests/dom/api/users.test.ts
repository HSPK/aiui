import { describe, expect, it } from "vitest";
import { users } from "@/lib/api/users";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/users", () => {
    it("is wired to /users with key 'users' (paginated default listShape)", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 20 }));
        await users.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/users");
        expect(users.keys.all()).toEqual(["users"]);
    });

    it("list(query) forwards UserFilterParams as URL params", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 2, page_size: 10 }));
        await users.list({ page: 2, page_size: 10, keyword: "ann", filter_admin: true });
        expect(fetchMock.mock.calls[0][0]).toBe(
            "/api/users?page=2&page_size=10&keyword=ann&filter_admin=true"
        );
    });

    it("create() POSTs to /users", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", username: "ann" }));
        await users.create({ username: "ann", password: "secret123" } as never);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users");
        expect(init.method).toBe("POST");
    });

    it("update() PATCHes /users/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", username: "ann2" }));
        await users.update("1", { username: "ann2" } as never);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users/1");
        expect(init.method).toBe("PATCH");
    });

    it("remove() DELETEs /users/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await users.remove("1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users/1");
        expect(init.method).toBe("DELETE");
    });
});
