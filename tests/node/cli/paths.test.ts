import { afterEach, describe, expect, it, vi } from "vitest";

// tests/setup/node.ts sets LOOM_PACKAGE_ROOT before this (or any) test
// file's imports run, so the module-level throw in lib/cli/paths.ts
// doesn't fire during normal collection. We manipulate the env var and
// re-import with vi.resetModules() to exercise both branches.

const ORIGINAL_ROOT = process.env.LOOM_PACKAGE_ROOT;

describe("lib/cli/paths", () => {
    afterEach(() => {
        if (ORIGINAL_ROOT === undefined) delete process.env.LOOM_PACKAGE_ROOT;
        else process.env.LOOM_PACKAGE_ROOT = ORIGINAL_ROOT;
        vi.resetModules();
    });

    it("exports PACKAGE_ROOT from LOOM_PACKAGE_ROOT and USER_CWD from process.cwd()", async () => {
        process.env.LOOM_PACKAGE_ROOT = "/fake/package/root";
        vi.resetModules();
        const mod = await import("@/lib/cli/paths");
        expect(mod.PACKAGE_ROOT).toBe("/fake/package/root");
        expect(mod.USER_CWD).toBe(process.cwd());
    });

    it("throws a descriptive error when LOOM_PACKAGE_ROOT is unset", async () => {
        delete process.env.LOOM_PACKAGE_ROOT;
        vi.resetModules();
        await expect(import("@/lib/cli/paths")).rejects.toThrow(
            /LOOM_PACKAGE_ROOT was not set/,
        );
    });

    it("throws when LOOM_PACKAGE_ROOT is set to an empty string (falsy)", async () => {
        process.env.LOOM_PACKAGE_ROOT = "";
        vi.resetModules();
        await expect(import("@/lib/cli/paths")).rejects.toThrow(
            /LOOM_PACKAGE_ROOT was not set/,
        );
    });

    it("re-reads process.cwd() for USER_CWD on every fresh import", async () => {
        process.env.LOOM_PACKAGE_ROOT = "/fake/root";
        vi.resetModules();
        const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/somewhere/else");
        const mod = await import("@/lib/cli/paths");
        expect(mod.USER_CWD).toBe("/somewhere/else");
        cwdSpy.mockRestore();
    });
});
