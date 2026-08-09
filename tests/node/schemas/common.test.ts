import { describe, expect, it } from "vitest";
import { z } from "zod";
import { baseResponseSchema, paginationQuerySchema } from "@/lib/schemas/common";

describe("baseResponseSchema", () => {
    it("wraps an arbitrary data schema in the {code, msg, data} envelope", () => {
        const schema = baseResponseSchema(z.object({ id: z.string() }));
        const result = schema.safeParse({ code: 0, msg: "ok", data: { id: "abc" } });
        expect(result.success).toBe(true);
    });

    it("rejects when the inner data fails its own schema", () => {
        const schema = baseResponseSchema(z.object({ id: z.string() }));
        const result = schema.safeParse({ code: 0, msg: "ok", data: { id: 123 } });
        expect(result.success).toBe(false);
    });

    it("rejects when code or msg are missing", () => {
        const schema = baseResponseSchema(z.string());
        const result = schema.safeParse({ data: "hi" });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join("."));
            expect(paths).toEqual(expect.arrayContaining(["code", "msg"]));
        }
    });

    it("works with a primitive data schema", () => {
        const schema = baseResponseSchema(z.number());
        expect(schema.parse({ code: 0, msg: "ok", data: 42 })).toEqual({ code: 0, msg: "ok", data: 42 });
    });

    it("works with a null data schema (e.g. empty responses)", () => {
        const schema = baseResponseSchema(z.null());
        expect(schema.parse({ code: 0, msg: "ok", data: null })).toEqual({ code: 0, msg: "ok", data: null });
    });
});

describe("paginationQuerySchema", () => {
    it("applies defaults when nothing is supplied", () => {
        const result = paginationQuerySchema.parse({});
        expect(result).toEqual({ page: 1, page_size: 20, sort: "-created_at" });
    });

    it("coerces string query-param numbers", () => {
        const result = paginationQuerySchema.parse({ page: "3", page_size: "50" });
        expect(result).toEqual({ page: 3, page_size: 50, sort: "-created_at" });
    });

    it("accepts a custom sort string", () => {
        const result = paginationQuerySchema.parse({ sort: "name" });
        expect(result.sort).toBe("name");
    });

    it("rejects page below 1", () => {
        const result = paginationQuerySchema.safeParse({ page: 0 });
        expect(result.success).toBe(false);
    });

    it("rejects page_size below 1", () => {
        const result = paginationQuerySchema.safeParse({ page_size: 0 });
        expect(result.success).toBe(false);
    });

    it("rejects page_size above 500", () => {
        const result = paginationQuerySchema.safeParse({ page_size: 501 });
        expect(result.success).toBe(false);
    });

    it("accepts page_size at the 500 boundary", () => {
        const result = paginationQuerySchema.safeParse({ page_size: 500 });
        expect(result.success).toBe(true);
    });

    it("rejects a non-numeric, non-coercible page", () => {
        const result = paginationQuerySchema.safeParse({ page: "abc" });
        expect(result.success).toBe(false);
    });

    it("rejects a non-integer page", () => {
        const result = paginationQuerySchema.safeParse({ page: 1.5 });
        expect(result.success).toBe(false);
    });
});
