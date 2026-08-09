import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetcher, rawFetch, withQuery } from "@/lib/api/client";
import { envelope, errJson, errUnparseable, installFetchMock, okJson } from "./test-helpers";

describe("lib/api/client", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = installFetchMock();
    });

    describe("ApiError", () => {
        it("carries status + optional code and is a real Error", () => {
            const err = new ApiError("boom", 418, 42);
            expect(err).toBeInstanceOf(Error);
            expect(err.name).toBe("ApiError");
            expect(err.message).toBe("boom");
            expect(err.status).toBe(418);
            expect(err.code).toBe(42);
        });

        it("code is optional", () => {
            const err = new ApiError("boom", 500);
            expect(err.code).toBeUndefined();
        });
    });

    describe("fetcher", () => {
        it("unwraps the envelope on success", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ hello: "world" }));
            const data = await fetcher<{ hello: string }>("/things");
            expect(data).toEqual({ hello: "world" });
        });

        it("always sends credentials:include and a JSON Content-Type", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
            await fetcher("/things");
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/things");
            expect(init.credentials).toBe("include");
            expect(init.headers["Content-Type"]).toBe("application/json");
        });

        it("merges caller headers without dropping the JSON default", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
            await fetcher("/things", { headers: { Accept: "text/plain" } });
            const [, init] = fetchMock.mock.calls[0];
            expect(init.headers["Content-Type"]).toBe("application/json");
            expect(init.headers.Accept).toBe("text/plain");
        });

        it("lets caller headers override the default Content-Type", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
            await fetcher("/things", { headers: { "Content-Type": "application/x-custom" } });
            const [, init] = fetchMock.mock.calls[0];
            expect(init.headers["Content-Type"]).toBe("application/x-custom");
        });

        it("forwards method/body through untouched", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ id: "1" }));
            await fetcher("/things", { method: "POST", body: JSON.stringify({ a: 1 }) });
            const [, init] = fetchMock.mock.calls[0];
            expect(init.method).toBe("POST");
            expect(init.body).toBe(JSON.stringify({ a: 1 }));
        });

        it("throws ApiError when code !== 0 even on HTTP 200", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify(envelope(null, 40001, "validation failed")), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
            await expect(fetcher("/things")).rejects.toMatchObject({
                name: "ApiError",
                message: "validation failed",
                status: 200,
                code: 40001,
            });
        });

        it("defaults the app-level error message when msg is empty", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 1, msg: "", data: null }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
            await expect(fetcher("/things")).rejects.toMatchObject({ message: "Unknown API Error" });
        });

        it("throws ApiError with parsed message/code on a non-2xx JSON error body", async () => {
            fetchMock.mockResolvedValueOnce(errJson(400, { code: 400123, msg: "bad request" }));
            await expect(fetcher("/things")).rejects.toMatchObject({
                name: "ApiError",
                message: "bad request",
                status: 400,
                code: 400123,
            });
        });

        it("falls back to statusText when the non-2xx body has no msg field", async () => {
            fetchMock.mockResolvedValueOnce(errJson(500, {}));
            await expect(fetcher("/things")).rejects.toMatchObject({
                message: "API Error: Error",
                status: 500,
                code: undefined,
            });
        });

        it("falls back to statusText when the non-2xx body is not JSON at all", async () => {
            fetchMock.mockResolvedValueOnce(errUnparseable(503, "Service Unavailable"));
            await expect(fetcher("/things")).rejects.toMatchObject({
                message: "API Error: Service Unavailable",
                status: 503,
                code: undefined,
            });
        });

        describe("401 handling", () => {
            const originalLocation = window.location;

            beforeEach(() => {
                // jsdom's real Location throws "Not implemented: navigation" and
                // never actually updates `.href`, so swap in a plain stub we can
                // assert against. Object.defineProperty (rather than a direct
                // assignment) avoids a TS2322 mismatch against Location's real
                // setter type.
                // @ts-expect-error - intentionally replacing the read-only jsdom Location.
                delete window.location;
                Object.defineProperty(window, "location", {
                    configurable: true,
                    value: {
                        pathname: "/dashboard",
                        search: "?tab=x",
                        href: "http://localhost:3000/dashboard?tab=x",
                    },
                });
            });

            afterEach(() => {
                Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
            });

            it("redirects to /login with a `from` param and throws", async () => {
                fetchMock.mockResolvedValueOnce(errJson(401, { msg: "nope" }));
                await expect(fetcher("/secret")).rejects.toMatchObject({
                    name: "ApiError",
                    message: "Unauthorized - redirecting to login",
                    status: 401,
                });
                expect(window.location.href).toBe(`/login?from=${encodeURIComponent("/dashboard?tab=x")}`);
            });

            it("does not redirect when skipAuthRedirect is set, and surfaces the body error instead", async () => {
                fetchMock.mockResolvedValueOnce(errJson(401, { msg: "invalid credentials", code: 1 }));
                await expect(fetcher("/login", { skipAuthRedirect: true })).rejects.toMatchObject({
                    message: "invalid credentials",
                    status: 401,
                    code: 1,
                });
                expect(window.location.href).toBe("http://localhost:3000/dashboard?tab=x");
            });

            it("does not redirect when already on the /login page", async () => {
                window.location.pathname = "/login";
                fetchMock.mockResolvedValueOnce(errJson(401, { msg: "nope" }));
                await expect(fetcher("/secret")).rejects.toMatchObject({ message: "nope", status: 401 });
                expect(window.location.href).toBe("http://localhost:3000/dashboard?tab=x");
            });

            it("does not redirect when window is undefined (SSR)", async () => {
                fetchMock.mockResolvedValueOnce(errJson(401, { msg: "nope-ssr" }));
                vi.stubGlobal("window", undefined);
                try {
                    await expect(fetcher("/secret")).rejects.toMatchObject({ message: "nope-ssr", status: 401 });
                } finally {
                    vi.unstubAllGlobals();
                }
            });
        });
    });

    describe("rawFetch", () => {
        it("returns the raw Response on success without unwrapping", async () => {
            const res = okJson({ anything: true });
            fetchMock.mockResolvedValueOnce(res);
            const got = await rawFetch("/stream");
            expect(got).toBe(res);
        });

        it("forces a JSON Content-Type for non-FormData bodies", async () => {
            fetchMock.mockResolvedValueOnce(okJson(null));
            await rawFetch("/things", { method: "POST", body: JSON.stringify({ a: 1 }) });
            const [, init] = fetchMock.mock.calls[0];
            expect(init.headers["Content-Type"]).toBe("application/json");
            expect(init.credentials).toBe("include");
        });

        it("does NOT force a Content-Type for FormData bodies (breaks multipart boundary otherwise)", async () => {
            fetchMock.mockResolvedValueOnce(okJson(null));
            const fd = new FormData();
            fd.append("file", new File(["hi"], "a.txt"));
            await rawFetch("/upload", { method: "POST", body: fd });
            const [, init] = fetchMock.mock.calls[0];
            expect(init.headers["Content-Type"]).toBeUndefined();
            expect(init.body).toBe(fd);
        });

        it("still merges explicit caller headers for FormData bodies", async () => {
            fetchMock.mockResolvedValueOnce(okJson(null));
            const fd = new FormData();
            await rawFetch("/upload", { method: "POST", body: fd, headers: { "X-Trace": "1" } });
            const [, init] = fetchMock.mock.calls[0];
            expect(init.headers["X-Trace"]).toBe("1");
            expect(init.headers["Content-Type"]).toBeUndefined();
        });

        it("throws ApiError with parsed message on non-2xx JSON body", async () => {
            fetchMock.mockResolvedValueOnce(errJson(404, { msg: "not found" }));
            await expect(rawFetch("/missing")).rejects.toMatchObject({
                name: "ApiError",
                message: "not found",
                status: 404,
            });
        });

        it("falls back to statusText when the JSON body has no msg field", async () => {
            fetchMock.mockResolvedValueOnce(errJson(500, {}));
            await expect(rawFetch("/missing")).rejects.toMatchObject({
                message: "API Error: Error",
                status: 500,
            });
        });

        it("falls back to statusText when the non-2xx body is unparseable", async () => {
            fetchMock.mockResolvedValueOnce(errUnparseable(500, "Internal Server Error"));
            await expect(rawFetch("/missing")).rejects.toMatchObject({
                message: "API Error: Internal Server Error",
                status: 500,
            });
        });

        describe("401 handling", () => {
            const originalLocation = window.location;

            beforeEach(() => {
                // @ts-expect-error - intentionally replacing the read-only jsdom Location.
                delete window.location;
                Object.defineProperty(window, "location", {
                    configurable: true,
                    value: {
                        pathname: "/playground/chat",
                        search: "",
                        href: "http://localhost:3000/playground/chat",
                    },
                });
            });

            afterEach(() => {
                Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
            });

            it("redirects to /login and throws", async () => {
                fetchMock.mockResolvedValueOnce(errJson(401, { msg: "nope" }));
                await expect(rawFetch("/secret")).rejects.toMatchObject({
                    message: "Unauthorized - redirecting to login",
                    status: 401,
                });
                expect(window.location.href).toBe(`/login?from=${encodeURIComponent("/playground/chat")}`);
            });

            it("skips the redirect when skipAuthRedirect is set", async () => {
                fetchMock.mockResolvedValueOnce(errJson(401, { msg: "creds bad" }));
                await expect(rawFetch("/login", { skipAuthRedirect: true })).rejects.toMatchObject({
                    message: "creds bad",
                    status: 401,
                });
                expect(window.location.href).toBe("http://localhost:3000/playground/chat");
            });
        });
    });

    describe("withQuery", () => {
        it("drops undefined, null and empty-string values", () => {
            expect(withQuery("/x", { a: undefined, b: null, c: "" })).toBe("/x");
        });

        it("keeps falsy-but-meaningful 0 and false values", () => {
            expect(withQuery("/x", { a: 0, b: false })).toBe("/x?a=0&b=false");
        });

        it("mixes kept and dropped params", () => {
            expect(withQuery("/x", { a: 1, b: undefined, c: "keep" })).toBe("/x?a=1&c=keep");
        });

        it("URL-encodes values the same way URLSearchParams does", () => {
            const expected = new URLSearchParams({ q: "a b&c" }).toString();
            expect(withQuery("/search", { q: "a b&c" })).toBe(`/search?${expected}`);
        });

        it("produces no trailing ? when every param is dropped", () => {
            expect(withQuery("/x", {})).toBe("/x");
            expect(withQuery("/x", { a: undefined })).toBe("/x");
        });
    });
});
