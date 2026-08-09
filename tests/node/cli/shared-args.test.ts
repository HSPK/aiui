import { describe, expect, it } from "vitest";
import { sharedServerArgs } from "@/lib/cli/shared-args";

describe("lib/cli/shared-args", () => {
    it("declares a string `port` arg aliased to -p", () => {
        expect(sharedServerArgs.port).toMatchObject({
            type: "string",
            alias: "p",
        });
        expect(sharedServerArgs.port.description).toEqual(expect.stringContaining("Port"));
    });

    it("declares a string `hostname` arg aliased to -H", () => {
        expect(sharedServerArgs.hostname).toMatchObject({
            type: "string",
            alias: "H",
        });
        expect(sharedServerArgs.hostname.description).toEqual(expect.stringContaining("Hostname"));
    });

    it("exposes exactly the port/hostname descriptors (no extra/undeclared flags)", () => {
        expect(Object.keys(sharedServerArgs).sort()).toEqual(["hostname", "port"]);
    });
});
