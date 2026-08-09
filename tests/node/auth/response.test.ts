// lib/server/response.ts — the {code,msg,data} envelope + HttpError +
// helper constructors (notFound/badRequest/unauthorized/forbidden/
// tooManyRequests) + the handle() error-to-Response translator.
import { describe, expect, it, vi } from "vitest";
import {
    badRequest,
    fail,
    forbidden,
    handle,
    HttpError,
    notFound,
    ok,
    tooManyRequests,
    unauthorized,
} from "@/lib/server/response";

describe("response: ok", () => {
    it("wraps data in the {code:0,msg:'ok',data} envelope with default 200 status", async () => {
        const res = ok({ hello: "world" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ code: 0, msg: "ok", data: { hello: "world" } });
    });

    it("passes through a custom ResponseInit (e.g. a non-default status)", async () => {
        const res = ok(null, { status: 201 });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json).toEqual({ code: 0, msg: "ok", data: null });
    });
});

describe("response: fail", () => {
    it("defaults to status 400 and code -1", async () => {
        const res = fail("bad input");
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json).toEqual({ code: -1, msg: "bad input", data: null });
    });

    it("accepts a custom status and code", async () => {
        const res = fail("teapot", 418, 42);
        expect(res.status).toBe(418);
        const json = await res.json();
        expect(json).toEqual({ code: 42, msg: "teapot", data: null });
    });

    it("merges extra ResponseInit (e.g. headers) alongside the forced status", async () => {
        const res = fail("nope", 400, -1, { headers: { "X-Test": "1" } });
        expect(res.headers.get("X-Test")).toBe("1");
        expect(res.status).toBe(400);
    });
});

describe("response: HttpError", () => {
    it("defaults status=400, code=-1, name='HttpError', and is an instanceof Error", () => {
        const err = new HttpError("oops");
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe("oops");
        expect(err.status).toBe(400);
        expect(err.code).toBe(-1);
        expect(err.name).toBe("HttpError");
        expect(err.headers).toBeUndefined();
    });

    it("accepts explicit status/code/headers", () => {
        const err = new HttpError("custom", 503, 7, { "Retry-After": "5" });
        expect(err.status).toBe(503);
        expect(err.code).toBe(7);
        expect(err.headers).toEqual({ "Retry-After": "5" });
    });
});

describe("response: notFound / badRequest / unauthorized / forbidden", () => {
    it("notFound defaults message and uses 404", () => {
        const err = notFound();
        expect(err.status).toBe(404);
        expect(err.message).toBe("Not found");
    });

    it("notFound accepts a custom message", () => {
        expect(notFound("no such user").message).toBe("no such user");
    });

    it("badRequest requires a message and uses 400", () => {
        const err = badRequest("missing field");
        expect(err.status).toBe(400);
        expect(err.message).toBe("missing field");
    });

    it("unauthorized defaults message and uses 401", () => {
        const err = unauthorized();
        expect(err.status).toBe(401);
        expect(err.message).toBe("Unauthorized");
    });

    it("unauthorized accepts a custom message", () => {
        expect(unauthorized("bad token").message).toBe("bad token");
    });

    it("forbidden defaults message and uses 403", () => {
        const err = forbidden();
        expect(err.status).toBe(403);
        expect(err.message).toBe("Forbidden");
    });

    it("forbidden accepts a custom message", () => {
        expect(forbidden("Admin required").message).toBe("Admin required");
    });
});

describe("response: tooManyRequests", () => {
    it("rounds fractional seconds up and sets Retry-After / status 429", () => {
        const err = tooManyRequests("slow down", 4.2);
        expect(err.status).toBe(429);
        expect(err.headers).toEqual({ "Retry-After": "5" });
    });

    it("clamps non-positive/negative retryAfterSeconds to a minimum of 1", () => {
        expect(tooManyRequests("x", 0).headers).toEqual({ "Retry-After": "1" });
        expect(tooManyRequests("x", -30).headers).toEqual({ "Retry-After": "1" });
    });

    it("passes an already-integer value through unchanged", () => {
        expect(tooManyRequests("x", 10).headers).toEqual({ "Retry-After": "10" });
    });
});

describe("response: handle", () => {
    it("converts an HttpError (with headers) into its status/code/message + headers", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const err = tooManyRequests("too many", 30);
        const res = handle(err);
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("30");
        const json = await res.json();
        expect(json).toEqual({ code: -1, msg: "too many", data: null });
        // HttpError branch does not itself log — only the generic-error
        // branch does. Confirm no accidental logging here.
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("converts an HttpError without headers (no extra ResponseInit)", async () => {
        const res = handle(badRequest("bad"));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.msg).toBe("bad");
    });

    it("converts a generic Error to a 500 using its message, and logs it", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = handle(new Error("boom"));
        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json).toEqual({ code: -1, msg: "boom", data: null });
        expect(consoleSpy).toHaveBeenCalledWith("[loom] unhandled error:", expect.any(Error));
        consoleSpy.mockRestore();
    });

    it("converts a non-Error thrown value to a generic 500 message, and logs it", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = handle("just a string");
        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json).toEqual({ code: -1, msg: "Internal server error", data: null });
        expect(consoleSpy).toHaveBeenCalledWith("[loom] unhandled error:", "just a string");
        consoleSpy.mockRestore();
    });
});
