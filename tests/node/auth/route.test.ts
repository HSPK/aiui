// lib/server/route.ts — defineRoute: the declarative Route Handler
// factory used by every app/api/**/route.ts file.
//
// @/lib/server/auth and @/lib/server/init are fully mocked so every auth
// branch (public/user/admin/gateway, success + rejection) can be driven
// deterministically without touching cookies/DB. @/lib/server/response
// is left real (already unit-tested in response.test.ts) so the
// envelopes asserted against here reflect genuine end-to-end wiring.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import type { SessionUser } from "@/lib/server/auth";

vi.mock("@/lib/server/init", () => ({ ensureInit: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({
    getCurrentUser: vi.fn(),
    requireUser: vi.fn(),
    requireAdmin: vi.fn(),
    authenticateGateway: vi.fn(),
}));

import { ensureInit } from "@/lib/server/init";
import { authenticateGateway, getCurrentUser, requireAdmin, requireUser } from "@/lib/server/auth";
import { defineRoute } from "@/lib/server/route";
import { HttpError } from "@/lib/server/response";

const USER: SessionUser = { id: "u1", username: "alice", role: "user", createdAt: "2024-01-01T00:00:00.000Z" };
const ADMIN: SessionUser = { id: "a1", username: "root", role: "admin", createdAt: "2024-01-01T00:00:00.000Z" };

function jsonReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
    return new NextRequest(url, init);
}

async function readJson(res: Response) {
    return (await res.json()) as { code: number; msg: string; data: unknown };
}

describe("route: defineRoute", () => {
    beforeEach(() => {
        vi.mocked(ensureInit).mockReset().mockResolvedValue(undefined);
        vi.mocked(getCurrentUser).mockReset();
        vi.mocked(requireUser).mockReset();
        vi.mocked(requireAdmin).mockReset();
        vi.mocked(authenticateGateway).mockReset();
    });

    // ---------------------------------------------------------------
    // auth modes
    // ---------------------------------------------------------------
    describe("auth modes", () => {
        it("calls ensureInit on every invocation", async () => {
            vi.mocked(requireUser).mockResolvedValue(USER);
            const GET = defineRoute({ handler: () => "ok" });
            await GET(jsonReq("http://localhost/api/x"));
            expect(ensureInit).toHaveBeenCalledTimes(1);
        });

        it("defaults to auth:'user' when opts.auth is omitted", async () => {
            vi.mocked(requireUser).mockResolvedValue(USER);
            const GET = defineRoute({ handler: ({ user }) => user });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(requireUser).toHaveBeenCalledTimes(1);
            expect(requireAdmin).not.toHaveBeenCalled();
            expect(getCurrentUser).not.toHaveBeenCalled();
            expect(authenticateGateway).not.toHaveBeenCalled();
            expect((await readJson(res)).data).toEqual(USER);
        });

        it("auth:'user' propagates a 401 rejection from requireUser", async () => {
            vi.mocked(requireUser).mockRejectedValue(new HttpError("Unauthorized", 401));
            const GET = defineRoute({ auth: "user", handler: () => "unreachable" });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(401);
            expect((await readJson(res)).msg).toBe("Unauthorized");
        });

        it("auth:'public' passes a null user through when unauthenticated", async () => {
            vi.mocked(getCurrentUser).mockResolvedValue(null);
            const GET = defineRoute({ auth: "public", handler: ({ user }) => ({ user }) });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).data).toEqual({ user: null });
        });

        it("auth:'public' passes the real user through when authenticated", async () => {
            vi.mocked(getCurrentUser).mockResolvedValue(USER);
            const GET = defineRoute({ auth: "public", handler: ({ user }) => ({ user }) });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).data).toEqual({ user: USER });
        });

        it("auth:'admin' resolves for an admin session", async () => {
            vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
            const GET = defineRoute({ auth: "admin", handler: ({ user }) => user });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).data).toEqual(ADMIN);
        });

        it("auth:'admin' propagates a 403 rejection from requireAdmin", async () => {
            vi.mocked(requireAdmin).mockRejectedValue(new HttpError("Admin required", 403));
            const GET = defineRoute({ auth: "admin", handler: () => "unreachable" });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(403);
            expect((await readJson(res)).msg).toBe("Admin required");
        });

        it("auth:'gateway' resolves and passes the request through to authenticateGateway", async () => {
            vi.mocked(authenticateGateway).mockResolvedValue(USER);
            const GET = defineRoute({ auth: "gateway", handler: ({ user }) => user });
            const req = jsonReq("http://localhost/api/v1/chat");
            const res = await GET(req);
            expect(authenticateGateway).toHaveBeenCalledWith(req);
            expect((await readJson(res)).data).toEqual(USER);
        });

        it("auth:'gateway' propagates a 401 rejection from authenticateGateway", async () => {
            vi.mocked(authenticateGateway).mockRejectedValue(new HttpError("Missing or invalid credentials", 401));
            const GET = defineRoute({ auth: "gateway", handler: () => "unreachable" });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(401);
        });
    });

    // ---------------------------------------------------------------
    // params
    // ---------------------------------------------------------------
    describe("params", () => {
        beforeEach(() => vi.mocked(requireUser).mockResolvedValue(USER));

        it("defaults params to {} when no ctx is supplied at all", async () => {
            const GET = defineRoute({ handler: ({ params }) => params });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).data).toEqual({});
        });

        it("defaults params to {} when ctx is supplied without a params key", async () => {
            const GET = defineRoute({ handler: ({ params }) => params });
            const res = await GET(jsonReq("http://localhost/api/x"), {} as never);
            expect((await readJson(res)).data).toEqual({});
        });

        it("passes ctx.params through unvalidated when no params schema is declared", async () => {
            const GET = defineRoute({ handler: ({ params }) => params });
            const res = await GET(jsonReq("http://localhost/api/x"), { params: Promise.resolve({ id: "xyz" }) });
            expect((await readJson(res)).data).toEqual({ id: "xyz" });
        });

        it("parses ctx.params against the schema when declared and valid", async () => {
            const GET = defineRoute({
                params: z.object({ id: z.string() }),
                handler: ({ params }) => params,
            });
            const res = await GET(jsonReq("http://localhost/api/x"), { params: Promise.resolve({ id: "abc" }) });
            expect((await readJson(res)).data).toEqual({ id: "abc" });
        });

        it("returns 400 with a 'params:'-labelled message when the schema rejects ctx.params", async () => {
            const GET = defineRoute({
                params: z.object({ id: z.string() }),
                handler: () => "unreachable",
            });
            const res = await GET(jsonReq("http://localhost/api/x"), { params: Promise.resolve({}) });
            expect(res.status).toBe(400);
            expect((await readJson(res)).msg).toMatch(/^id: /);
        });
    });

    // ---------------------------------------------------------------
    // query
    // ---------------------------------------------------------------
    describe("query", () => {
        beforeEach(() => vi.mocked(requireUser).mockResolvedValue(USER));

        it("passes the raw searchParams object through when no query schema is declared", async () => {
            const GET = defineRoute({ handler: ({ query }) => query });
            const res = await GET(jsonReq("http://localhost/api/x?a=1&b=two"));
            expect((await readJson(res)).data).toEqual({ a: "1", b: "two" });
        });

        it("parses + coerces query against the schema when declared and valid", async () => {
            const GET = defineRoute({
                query: z.object({ page: z.coerce.number() }),
                handler: ({ query }) => query,
            });
            const res = await GET(jsonReq("http://localhost/api/x?page=3"));
            expect((await readJson(res)).data).toEqual({ page: 3 });
        });

        it("returns 400 with a 'query:'-labelled message when the schema rejects the query", async () => {
            const GET = defineRoute({
                query: z.object({ mode: z.enum(["a", "b"]) }),
                handler: () => "unreachable",
            });
            const res = await GET(jsonReq("http://localhost/api/x?mode=z"));
            expect(res.status).toBe(400);
            expect((await readJson(res)).msg).toMatch(/^mode: /);
        });
    });

    // ---------------------------------------------------------------
    // body
    // ---------------------------------------------------------------
    describe("body", () => {
        beforeEach(() => vi.mocked(requireUser).mockResolvedValue(USER));

        it("leaves body undefined when no body schema is declared, even for POST", async () => {
            const POST = defineRoute({ handler: ({ body }) => ({ body }) });
            const res = await POST(jsonReq("http://localhost/api/x", { method: "POST", body: "not json at all" }));
            expect((await readJson(res)).data).toEqual({ body: undefined });
        });

        it("GET never calls req.json(): a bodyless GET still validates against {}", async () => {
            const GET = defineRoute({
                body: z.object({ x: z.string().optional() }),
                handler: ({ body }) => body,
            });
            // No body at all is set on this GET request. If the implementation
            // incorrectly called req.json() here it would throw on the empty
            // stream and this would come back as 400, not 200.
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(200);
            expect((await readJson(res)).data).toEqual({});
        });

        it("HEAD never calls req.json(): a bodyless HEAD still validates against {}", async () => {
            const HEAD = defineRoute({
                body: z.object({ x: z.string().optional() }),
                handler: ({ body }) => body,
            });
            const res = await HEAD(jsonReq("http://localhost/api/x", { method: "HEAD" }));
            expect(res.status).toBe(200);
            expect((await readJson(res)).data).toEqual({});
        });

        it("POST with malformed JSON returns 400 'Request body must be valid JSON'", async () => {
            const POST = defineRoute({
                body: z.object({ x: z.string() }),
                handler: () => "unreachable",
            });
            const res = await POST(jsonReq("http://localhost/api/x", { method: "POST", body: "{not-json" }));
            expect(res.status).toBe(400);
            expect((await readJson(res)).msg).toBe("Request body must be valid JSON");
        });

        it("POST with valid JSON that fails the schema returns 400 with a 'body:'-labelled message", async () => {
            const POST = defineRoute({
                body: z.object({ id: z.string() }),
                handler: () => "unreachable",
            });
            const res = await POST(
                jsonReq("http://localhost/api/x", { method: "POST", body: JSON.stringify({}) }),
            );
            expect(res.status).toBe(400);
            expect((await readJson(res)).msg).toMatch(/^id: /);
        });

        it("POST with valid JSON that passes the schema forwards the parsed body to the handler", async () => {
            const POST = defineRoute({
                body: z.object({ id: z.string() }),
                handler: ({ body }) => body,
            });
            const res = await POST(
                jsonReq("http://localhost/api/x", { method: "POST", body: JSON.stringify({ id: "abc" }) }),
            );
            expect((await readJson(res)).data).toEqual({ id: "abc" });
        });
    });

    // ---------------------------------------------------------------
    // handler return-value handling
    // ---------------------------------------------------------------
    describe("handler return values", () => {
        beforeEach(() => vi.mocked(requireUser).mockResolvedValue(USER));

        it("wraps a plain return value in ok()", async () => {
            const GET = defineRoute({ handler: () => ({ hello: "world" }) });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(await readJson(res)).toEqual({ code: 0, msg: "ok", data: { hello: "world" } });
        });

        it("wraps an undefined return value as ok(null)", async () => {
            const GET = defineRoute({ handler: () => undefined });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(await readJson(res)).toEqual({ code: 0, msg: "ok", data: null });
        });

        it("passes a native Response through untouched, bypassing the ok() envelope", async () => {
            const GET = defineRoute({
                handler: () => NextResponse.json({ custom: true }, { status: 201, headers: { "X-Foo": "bar" } }),
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(201);
            expect(res.headers.get("X-Foo")).toBe("bar");
            expect(await res.json()).toEqual({ custom: true });
        });
    });

    // ---------------------------------------------------------------
    // error handling
    // ---------------------------------------------------------------
    describe("errors thrown from the handler", () => {
        beforeEach(() => vi.mocked(requireUser).mockResolvedValue(USER));

        it("HttpError -> its own status/message/code", async () => {
            const GET = defineRoute({
                handler: () => {
                    throw new HttpError("nope", 409, 42);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(409);
            expect(await readJson(res)).toEqual({ code: 42, msg: "nope", data: null });
        });

        it("a generic Error -> 500 with its message, and logs via console.error", async () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const GET = defineRoute({
                handler: () => {
                    throw new Error("boom");
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(500);
            expect((await readJson(res)).msg).toBe("boom");
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it("a raw ZodError thrown from the handler -> 400, formatted with the default 'input' label, WITHOUT going through handle()/console.error", async () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const GET = defineRoute({
                handler: () => {
                    throw new ZodError([{ code: "custom", message: "bad value", path: ["field"] }]);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(400);
            expect((await readJson(res)).msg).toBe("field: bad value");
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("a raw ZodError with an empty issues array -> 'Invalid input' (default label)", async () => {
            const GET = defineRoute({
                handler: () => {
                    throw new ZodError([]);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(400);
            expect((await readJson(res)).msg).toBe("Invalid input");
        });

        it("a raw ZodError with a root-level issue (empty path) falls back to the default 'input' label", async () => {
            const GET = defineRoute({
                handler: () => {
                    throw new ZodError([{ code: "custom", message: "root problem", path: [] }]);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).msg).toBe("input: root problem");
        });

        it("a raw ZodError with a nested path joins segments with '.'", async () => {
            const GET = defineRoute({
                handler: () => {
                    throw new ZodError([{ code: "custom", message: "nested bad", path: ["user", "name"] }]);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).msg).toBe("user.name: nested bad");
        });

        it("a raw ZodError with multiple issues joins them with '; '", async () => {
            const GET = defineRoute({
                handler: () => {
                    throw new ZodError([
                        { code: "custom", message: "bad a", path: ["a"] },
                        { code: "custom", message: "bad b", path: ["b"] },
                    ]);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect((await readJson(res)).msg).toBe("a: bad a; b: bad b");
        });

        it("a non-Error thrown value -> 500 'Internal server error', and logs via console.error", async () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const GET = defineRoute({
                handler: () => {
                    // Deliberately a non-Error rejection: typed `unknown` so it is a
                    // real runtime string without tripping the throw-an-Error lint.
                    const rawThrown: unknown = "just a string";
                    throw rawThrown;
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            expect(res.status).toBe(500);
            expect((await readJson(res)).msg).toBe("Internal server error");
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    // ---------------------------------------------------------------
    // formatZodIssues: "required" vs. "wrong type" differentiation
    // (see lib/server/route.ts valueAtPath/NO_INPUT — fixed the zod-v4
    // regression where `received === "undefined"` never matched)
    // ---------------------------------------------------------------
    describe("formatZodIssues: missing vs. wrong-type field messages", () => {
        beforeEach(() => vi.mocked(requireUser).mockResolvedValue(USER));

        it("a missing required top-level field formats as '<field>: required'", async () => {
            const POST = defineRoute({
                body: z.object({ id: z.string() }),
                handler: () => "unreachable",
            });
            const res = await POST(
                jsonReq("http://localhost/api/x", { method: "POST", body: JSON.stringify({}) }),
            );
            const json = await readJson(res);
            expect(res.status).toBe(400);
            expect(json.msg).toBe("id: required");
        });

        it("a present-but-wrong-type top-level field keeps zod's own message, NOT 'required'", async () => {
            const POST = defineRoute({
                body: z.object({ id: z.string() }),
                handler: () => "unreachable",
            });
            const res = await POST(
                jsonReq("http://localhost/api/x", { method: "POST", body: JSON.stringify({ id: 123 }) }),
            );
            const json = await readJson(res);
            expect(res.status).toBe(400);
            expect(json.msg).not.toBe("id: required");
            expect(json.msg).toMatch(/^id: /);
            expect(json.msg).toContain("received number");
        });

        it("a missing nested field formats as '<parent>.<child>: required'", async () => {
            const POST = defineRoute({
                body: z.object({ a: z.object({ b: z.string() }) }),
                handler: () => "unreachable",
            });
            const res = await POST(
                jsonReq("http://localhost/api/x", { method: "POST", body: JSON.stringify({ a: {} }) }),
            );
            const json = await readJson(res);
            expect(res.status).toBe(400);
            expect(json.msg).toBe("a.b: required");
        });

        it("a missing field inside an array element formats as '<field>.<index>.<child>: required'", async () => {
            const POST = defineRoute({
                body: z.object({ items: z.array(z.object({ name: z.string() })) }),
                handler: () => "unreachable",
            });
            const res = await POST(
                jsonReq("http://localhost/api/x", {
                    method: "POST",
                    body: JSON.stringify({ items: [{}] }),
                }),
            );
            const json = await readJson(res);
            expect(res.status).toBe(400);
            expect(json.msg).toBe("items.0.name: required");
        });

        it("a ZodError thrown from INSIDE a handler has no input to resolve against, so an invalid_type issue never claims 'required'", async () => {
            // formatZodIssues only receives the original input via parseOrThrow
            // (params/body/query). A ZodError raised by the handler itself
            // reaches the catch block with the NO_INPUT sentinel, so even an
            // invalid_type issue must fall back to zod's raw message rather
            // than guess that the field was absent.
            const GET = defineRoute({
                handler: () => {
                    throw new ZodError([
                        {
                            code: "invalid_type",
                            expected: "string",
                            path: ["id"],
                            message: "Invalid input: expected string, received undefined",
                        },
                    ]);
                },
            });
            const res = await GET(jsonReq("http://localhost/api/x"));
            const json = await readJson(res);
            expect(res.status).toBe(400);
            expect(json.msg).not.toBe("id: required");
            expect(json.msg).toBe("id: Invalid input: expected string, received undefined");
        });
    });
});
