import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cli/init/wizard", () => ({ runInteractiveInit: vi.fn(async () => undefined) }));

import { runInteractiveInit } from "@/lib/cli/init/wizard";
import { initCommand } from "@/lib/cli/commands/init";

describe("lib/cli/commands/init", () => {
    beforeEach(() => {
        vi.mocked(runInteractiveInit).mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("has the expected meta", () => {
        expect(initCommand.meta).toMatchObject({
            name: "init",
            description: expect.stringContaining("wizard"),
        });
    });

    it("declares out/user/force/yes(-y)/print args", () => {
        const args = initCommand.args as Record<string, { type: string; alias?: string | string[] }>;
        expect(args.out).toMatchObject({ type: "string" });
        expect(args.user).toMatchObject({ type: "boolean" });
        expect(args.force).toMatchObject({ type: "boolean" });
        expect(args.yes).toMatchObject({ type: "boolean", alias: "y" });
        expect(args.print).toMatchObject({ type: "boolean" });
    });

    it("forwards all parsed flags to runInteractiveInit", async () => {
        await initCommand.run?.({
            args: {
                out: "custom.yaml", user: true, force: true, yes: true, print: false, _: [],
            } as never,
            rawArgs: [],
            cmd: initCommand,
        });

        expect(runInteractiveInit).toHaveBeenCalledWith({
            explicitOut: "custom.yaml",
            user: true,
            force: true,
            yes: true,
            print: false,
        });
    });

    it("forwards undefined flags untouched when not provided", async () => {
        await initCommand.run?.({
            args: { _: [] } as never,
            rawArgs: [],
            cmd: initCommand,
        });

        expect(runInteractiveInit).toHaveBeenCalledWith({
            explicitOut: undefined,
            user: undefined,
            force: undefined,
            yes: undefined,
            print: undefined,
        });
    });

    it("awaits runInteractiveInit (propagates rejection)", async () => {
        vi.mocked(runInteractiveInit).mockRejectedValueOnce(new Error("boom"));

        await expect(
            initCommand.run?.({ args: { _: [] } as never, rawArgs: [], cmd: initCommand }),
        ).rejects.toThrow("boom");
    });
});
