import { describe, expect, it } from "vitest";
import { auth } from "@/lib/api/auth";
import { installFetchMock, okJson } from "./test-helpers";

describe("lib/api/auth", () => {
    it("login() POSTs credentials to /login with skipAuthRedirect", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", username: "ann" }));
        const data = await auth.login({ user_name: "ann", user_password: "secret" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/login");
        expect(init.method).toBe("POST");
        expect(init.body).toBe(JSON.stringify({ user_name: "ann", user_password: "secret" }));
        // `fetcher` spreads `...options` verbatim into the real fetch init,
        // so skipAuthRedirect legitimately rides along (harmless: the native
        // fetch spec ignores unrecognized RequestInit keys).
        expect((init as Record<string, unknown>).skipAuthRedirect).toBe(true);
        expect(data).toEqual({ id: "1", username: "ann" });
    });

    it("login() does NOT redirect on 401 (skipAuthRedirect honored)", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ code: 401, msg: "bad credentials" }), { status: 401 })
        );
        const originalLocation = window.location;
        // @ts-expect-error - replacing read-only jsdom Location for assertion purposes.
        delete window.location;
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { href: "http://localhost/login" },
        });
        try {
            await expect(auth.login({ user_name: "ann", user_password: "wrong" })).rejects.toThrow();
            expect(window.location.href).toBe("http://localhost/login");
        } finally {
            Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
        }
    });

    it("logout() POSTs to /logout with skipAuthRedirect", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await auth.logout();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/logout");
        expect(init.method).toBe("POST");
    });

    it("me() GETs /users/me", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", username: "ann" }));
        await auth.me();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users/me");
        expect(init.method).toBeUndefined();
    });

    it("changeOwnPassword() PATCHes /users/me with the password payload", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
        const data = await auth.changeOwnPassword({ current_password: "old", new_password: "newpass" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/users/me");
        expect(init.method).toBe("PATCH");
        expect(init.body).toBe(JSON.stringify({ current_password: "old", new_password: "newpass" }));
        expect(data).toEqual({ ok: true });
    });

    it("changeOwnPassword() DOES redirect on 401 (no skipAuthRedirect)", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ code: 401, msg: "expired" }), { status: 401 })
        );
        const originalLocation = window.location;
        // @ts-expect-error - replacing read-only jsdom Location for assertion purposes.
        delete window.location;
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { pathname: "/settings", search: "", href: "http://localhost/settings" },
        });
        try {
            await expect(
                auth.changeOwnPassword({ current_password: "old", new_password: "newpass" })
            ).rejects.toThrow();
            expect(window.location.href).toBe("/login?from=%2Fsettings");
        } finally {
            Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
        }
    });
});
