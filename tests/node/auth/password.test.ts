// lib/server/auth/password.ts — bcrypt hash/verify wrapper.
//
// bcrypt is deliberately slow (BCRYPT_COST = 10). We keep the number of
// hashing/comparison calls to a minimum (one hash + two compares) and
// raise the test timeout so a busy CI/container CPU doesn't flake.
import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/server/auth/password";

vi.setConfig({ testTimeout: 20000 });

describe("auth/password", () => {
    it("hashes a password into a non-plaintext bcrypt hash, and verifies correct/incorrect passwords", async () => {
        const plain = "correct-horse-battery-staple";
        const hash = await hashPassword(plain);

        expect(hash).not.toBe(plain);
        expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/); // bcrypt hash format, cost baked in

        await expect(verifyPassword(plain, hash)).resolves.toBe(true);
        await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
    });

    it("verifyPassword returns false (without invoking bcrypt) when hash is falsy", async () => {
        await expect(verifyPassword("anything", "")).resolves.toBe(false);
    });

    it("hashPassword salts each call, so hashing the same plaintext twice yields different hashes", async () => {
        const plain = "same-password";
        const [h1, h2] = await Promise.all([hashPassword(plain), hashPassword(plain)]);
        expect(h1).not.toBe(h2);
        await expect(verifyPassword(plain, h1)).resolves.toBe(true);
        await expect(verifyPassword(plain, h2)).resolves.toBe(true);
    });
});
