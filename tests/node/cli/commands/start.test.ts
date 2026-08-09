import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cli/next-runtime", () => ({ runNext: vi.fn() }));

import { runNext } from "@/lib/cli/next-runtime";
import { startCommand } from "@/lib/cli/commands/start";

describe("lib/cli/commands/start", () => {
    beforeEach(() => {
        vi.mocked(runNext).mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("has the expected meta", () => {
        expect(startCommand.meta).toMatchObject({
            name: "start",
            description: expect.stringContaining("production"),
        });
    });

    it("shares the sharedServerArgs descriptor (port/hostname)", () => {
        expect(Object.keys(startCommand.args ?? {}).sort()).toEqual(["hostname", "port"]);
    });

    it("delegates to runNext('start', {port,hostname}) with the parsed args", () => {
        startCommand.run?.({
            args: { port: "4000", hostname: "0.0.0.0", _: [] } as never,
            rawArgs: [],
            cmd: startCommand,
        });

        expect(runNext).toHaveBeenCalledWith("start", { port: "4000", hostname: "0.0.0.0" });
    });

    it("passes through undefined port/hostname untouched when not provided", () => {
        startCommand.run?.({
            args: { _: [] } as never,
            rawArgs: [],
            cmd: startCommand,
        });

        expect(runNext).toHaveBeenCalledWith("start", { port: undefined, hostname: undefined });
    });
});
