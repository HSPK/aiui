// lib/server/bootstrap.ts — bootstrapAdmin(): creates the first admin
// user from LOOM_ADMIN_USERNAME/LOOM_ADMIN_PASSWORD when the users table
// is empty. `bootstrapped` is a module-level "already ran" flag, so each
// test gets a fresh module via vi.resetModules() + dynamic import.
// hashPassword runs for real (bcrypt, cost ~10) — kept to a small number
// of calls, with a bumped timeout to tolerate it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/auth/password";
import { resetDb, seedUser } from "@/tests/helpers/db";

vi.setConfig({ testTimeout: 20000 });

async function freshBootstrap() {
    vi.resetModules();
    const { bootstrapAdmin } = await import("@/lib/server/bootstrap");
    return bootstrapAdmin;
}

function allUsers() {
    return db.select().from(schema.users).all();
}

describe("bootstrap: bootstrapAdmin", () => {
    beforeEach(() => {
        resetDb();
        delete process.env.LOOM_ADMIN_PASSWORD;
        delete process.env.LOOM_ADMIN_USERNAME;
        vi.restoreAllMocks();
    });

    it("no users + LOOM_ADMIN_PASSWORD set -> creates an admin with a bcrypt-hashed password", async () => {
        process.env.LOOM_ADMIN_PASSWORD = "correct-horse-battery-staple";
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const bootstrapAdmin = await freshBootstrap();

        await bootstrapAdmin();

        const rows = allUsers();
        expect(rows).toHaveLength(1);
        expect(rows[0].username).toBe("admin");
        expect(rows[0].role).toBe("admin");
        expect(rows[0].passwordHash).toMatch(/^\$2[aby]\$/);
        await expect(verifyPassword("correct-horse-battery-staple", rows[0].passwordHash)).resolves.toBe(true);
        expect(logSpy).toHaveBeenCalledWith('[loom] Bootstrapped admin user "admin".');
    });

    it("honours LOOM_ADMIN_USERNAME when set", async () => {
        process.env.LOOM_ADMIN_PASSWORD = "another-strong-password";
        process.env.LOOM_ADMIN_USERNAME = "superadmin";
        vi.spyOn(console, "log").mockImplementation(() => {});
        const bootstrapAdmin = await freshBootstrap();

        await bootstrapAdmin();

        const rows = allUsers();
        expect(rows).toHaveLength(1);
        expect(rows[0].username).toBe("superadmin");
    });

    it("no users + no LOOM_ADMIN_PASSWORD -> warns and creates nobody", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const bootstrapAdmin = await freshBootstrap();

        await bootstrapAdmin();

        expect(allUsers()).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("LOOM_ADMIN_PASSWORD is not set");
    });

    it("users already exist -> no-op, even if LOOM_ADMIN_PASSWORD is set", async () => {
        const existing = seedUser({ username: "already-here", role: "user" });
        process.env.LOOM_ADMIN_PASSWORD = "would-be-ignored";
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const bootstrapAdmin = await freshBootstrap();

        await bootstrapAdmin();

        const rows = allUsers();
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(existing.id);
        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("is idempotent within one module instance: a second call is a true no-op (no duplicate-username insert)", async () => {
        process.env.LOOM_ADMIN_PASSWORD = "correct-horse-battery-staple";
        vi.spyOn(console, "log").mockImplementation(() => {});
        const bootstrapAdmin = await freshBootstrap();

        await bootstrapAdmin();
        // A second call, still within the same module instance: if the
        // `bootstrapped` guard didn't short-circuit, this would attempt a
        // second INSERT with the same username and blow up on the unique
        // constraint — so simply not throwing (and row count staying at 1)
        // proves the guard is effective.
        await bootstrapAdmin();

        expect(allUsers()).toHaveLength(1);
    });
});
