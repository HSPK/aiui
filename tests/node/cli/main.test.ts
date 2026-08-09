import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_VERSION = process.env.LOOM_VERSION;

describe("lib/cli/main", () => {
    afterEach(() => {
        if (ORIGINAL_VERSION === undefined) delete process.env.LOOM_VERSION;
        else process.env.LOOM_VERSION = ORIGINAL_VERSION;
        vi.resetModules();
    });

    it("registers every subcommand under its own name", async () => {
        const { main } = await import("@/lib/cli/main");
        const { startCommand } = await import("@/lib/cli/commands/start");
        const { devCommand } = await import("@/lib/cli/commands/dev");
        const { initCommand } = await import("@/lib/cli/commands/init");
        const { updateCommand } = await import("@/lib/cli/commands/update");

        expect(main.subCommands).toEqual({
            start: startCommand,
            dev: devCommand,
            init: initCommand,
            update: updateCommand,
        });
    });

    it("falls through to `start` when no subcommand is given", async () => {
        const { main } = await import("@/lib/cli/main");
        expect(main.default).toBe("start");
    });

    it("sets meta.name to loom and a non-empty description", async () => {
        const { main } = await import("@/lib/cli/main");
        expect(main.meta).toMatchObject({ name: "loom" });
        expect(typeof (main.meta as { description?: string }).description).toBe("string");
        expect((main.meta as { description: string }).description.length).toBeGreaterThan(0);
    });

    it("defaults meta.version to 0.0.0-dev when LOOM_VERSION is unset", async () => {
        delete process.env.LOOM_VERSION;
        vi.resetModules();
        const { main } = await import("@/lib/cli/main");
        expect((main.meta as { version?: string }).version).toBe("0.0.0-dev");
    });

    it("uses LOOM_VERSION for meta.version when set", async () => {
        process.env.LOOM_VERSION = "9.9.9";
        vi.resetModules();
        const { main } = await import("@/lib/cli/main");
        expect((main.meta as { version?: string }).version).toBe("9.9.9");
    });

    it("has no `run` of its own (default delegates without double-executing)", async () => {
        const { main } = await import("@/lib/cli/main");
        expect(main.run).toBeUndefined();
    });
});
