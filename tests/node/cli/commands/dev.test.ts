import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cli/next-runtime", () => ({ runNext: vi.fn() }));

import { runNext } from "@/lib/cli/next-runtime";
import { devCommand } from "@/lib/cli/commands/dev";

describe("lib/cli/commands/dev", () => {
    beforeEach(() => {
        vi.mocked(runNext).mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("has the expected meta", () => {
        expect(devCommand.meta).toMatchObject({
            name: "dev",
            description: expect.stringContaining("development"),
        });
    });

    it("shares the sharedServerArgs descriptor (port/hostname)", () => {
        expect(Object.keys(devCommand.args ?? {}).sort()).toEqual(["hostname", "port"]);
    });

    it("delegates to runNext('dev', {port,hostname}) with the parsed args", () => {
        devCommand.run?.({
            args: { port: "5050", hostname: "localhost", _: [] } as never,
            rawArgs: [],
            cmd: devCommand,
        });

        expect(runNext).toHaveBeenCalledWith("dev", { port: "5050", hostname: "localhost" });
    });

    it("passes through undefined port/hostname untouched when not provided", () => {
        devCommand.run?.({
            args: { _: [] } as never,
            rawArgs: [],
            cmd: devCommand,
        });

        expect(runNext).toHaveBeenCalledWith("dev", { port: undefined, hostname: undefined });
    });
});
