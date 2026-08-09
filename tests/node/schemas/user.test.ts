import { describe, expect, it } from "vitest";
import {
    userDTOSchema,
    loginSchema,
    userCreateSchema,
    userUpdateSchema,
    selfPasswordSchema,
    userListQuerySchema,
} from "@/lib/schemas/user";

describe("userDTOSchema", () => {
    it("parses a valid user DTO", () => {
        const result = userDTOSchema.safeParse({ username: "alice", role: "admin", created_at: "2024-01-01" });
        expect(result.success).toBe(true);
    });

    it("allows created_at to be omitted", () => {
        const result = userDTOSchema.safeParse({ username: "alice", role: "user" });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid role", () => {
        const result = userDTOSchema.safeParse({ username: "alice", role: "superuser" });
        expect(result.success).toBe(false);
    });
});

describe("loginSchema", () => {
    it("accepts trimmed username with any non-empty password", () => {
        const result = loginSchema.safeParse({ user_name: "  alice  ", user_password: "x" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.user_name).toBe("alice");
    });

    it("rejects an empty username", () => {
        const result = loginSchema.safeParse({ user_name: "", user_password: "x" });
        expect(result.success).toBe(false);
    });

    it("rejects a whitespace-only username", () => {
        const result = loginSchema.safeParse({ user_name: "   ", user_password: "x" });
        expect(result.success).toBe(false);
    });

    it("rejects an empty password", () => {
        const result = loginSchema.safeParse({ user_name: "alice", user_password: "" });
        expect(result.success).toBe(false);
    });
});

describe("userCreateSchema", () => {
    it("defaults role to 'user' when omitted", () => {
        const result = userCreateSchema.parse({ username: "bob", password: "1234" });
        expect(result.role).toBe("user");
    });

    it("accepts an explicit admin role", () => {
        const result = userCreateSchema.parse({ username: "bob", password: "1234", role: "admin" });
        expect(result.role).toBe("admin");
    });

    it("rejects an empty username", () => {
        const result = userCreateSchema.safeParse({ username: "", password: "1234" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("Username is required");
    });

    it("rejects a password shorter than 4 characters", () => {
        const result = userCreateSchema.safeParse({ username: "bob", password: "123" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe("Password must be at least 4 characters");
        }
    });

    it("accepts a password exactly 4 characters long", () => {
        const result = userCreateSchema.safeParse({ username: "bob", password: "1234" });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid role value", () => {
        const result = userCreateSchema.safeParse({ username: "bob", password: "1234", role: "root" });
        expect(result.success).toBe(false);
    });
});

describe("userUpdateSchema", () => {
    it("accepts an empty object", () => {
        expect(userUpdateSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a password-only update", () => {
        expect(userUpdateSchema.safeParse({ password: "abcd" }).success).toBe(true);
    });

    it("rejects a too-short password", () => {
        expect(userUpdateSchema.safeParse({ password: "ab" }).success).toBe(false);
    });

    it("accepts a role-only update", () => {
        expect(userUpdateSchema.safeParse({ role: "admin" }).success).toBe(true);
    });

    it("rejects an invalid role", () => {
        expect(userUpdateSchema.safeParse({ role: "owner" }).success).toBe(false);
    });
});

describe("selfPasswordSchema", () => {
    it("accepts a valid current/new password pair", () => {
        const result = selfPasswordSchema.safeParse({ current_password: "old", new_password: "newpass" });
        expect(result.success).toBe(true);
    });

    it("rejects an empty current_password", () => {
        const result = selfPasswordSchema.safeParse({ current_password: "", new_password: "newpass" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe("Current password is required");
        }
    });

    it("rejects a new_password shorter than 4 characters", () => {
        const result = selfPasswordSchema.safeParse({ current_password: "old", new_password: "abc" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe("New password must be at least 4 characters");
        }
    });
});

describe("userListQuerySchema", () => {
    it("applies all defaults", () => {
        const result = userListQuerySchema.parse({});
        expect(result).toEqual({ page: 1, page_size: 20, sort: "-created_at" });
    });

    it("coerces page / page_size from strings", () => {
        const result = userListQuerySchema.parse({ page: "2", page_size: "10" });
        expect(result.page).toBe(2);
        expect(result.page_size).toBe(10);
    });

    it("rejects page_size above 200", () => {
        expect(userListQuerySchema.safeParse({ page_size: 201 }).success).toBe(false);
    });

    it("trims the keyword filter", () => {
        const result = userListQuerySchema.parse({ keyword: "  alice  " });
        expect(result.keyword).toBe("alice");
    });

    it("accepts filter_admin as the literal string 'true'", () => {
        const result = userListQuerySchema.safeParse({ filter_admin: "true" });
        expect(result.success).toBe(true);
    });

    it("accepts filter_admin as the literal string 'false'", () => {
        const result = userListQuerySchema.safeParse({ filter_admin: "false" });
        expect(result.success).toBe(true);
    });

    it("rejects filter_admin as a boolean (must be the string form)", () => {
        const result = userListQuerySchema.safeParse({ filter_admin: true });
        expect(result.success).toBe(false);
    });
});
