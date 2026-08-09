import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupTempDir, makeFakeChild, makeTempDir } from "./test-helpers";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("@/lib/cli/external-aliases", () => ({ ensureExternalAliases: vi.fn() }));
vi.mock("@/lib/preflight", () => ({
    preflightFromConfig: vi.fn(() => ({ path: null, cfg: null, applied: [] })),
}));

import { spawn } from "node:child_process";
import { ensureExternalAliases } from "@/lib/cli/external-aliases";
import { preflightFromConfig } from "@/lib/preflight";
import { PACKAGE_ROOT } from "@/lib/cli/paths";
import { resolveNextBin, runNext } from "@/lib/cli/next-runtime";

const ORIGINAL_ROOT = process.env.LOOM_PACKAGE_ROOT;
const ENV_KEYS = ["LOOM_SERVER_PORT", "PORT", "LOOM_SERVER_HOSTNAME"] as const;
const originalEnv: Record<string, string | undefined> = {};

describe("lib/cli/next-runtime", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        for (const k of ENV_KEYS) {
            originalEnv[k] = process.env[k];
            delete process.env[k];
        }
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
        logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.mocked(spawn).mockReset();
        vi.mocked(ensureExternalAliases).mockReset();
        vi.mocked(preflightFromConfig).mockReset().mockReturnValue({ path: null, cfg: null, applied: [] });
    });

    afterEach(() => {
        exitSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
        for (const k of ENV_KEYS) {
            if (originalEnv[k] === undefined) delete process.env[k];
            else process.env[k] = originalEnv[k];
        }
        if (ORIGINAL_ROOT === undefined) delete process.env.LOOM_PACKAGE_ROOT;
        else process.env.LOOM_PACKAGE_ROOT = ORIGINAL_ROOT;
    });

    describe("resolveNextBin", () => {
        it("returns the real path to next/dist/bin/next when it resolves (found)", () => {
            const bin = resolveNextBin();
            expect(bin).toContain("next");
            expect(bin.endsWith(join("next", "dist", "bin", "next"))).toBe(true);
            expect(existsSync(bin)).toBe(true);
            expect(exitSpy).not.toHaveBeenCalled();
        });

        it("prints an error and calls process.exit(1) when next can't be resolved (not-found)", async () => {
            // Fresh PACKAGE_ROOT with no node_modules at all -> resolve() throws.
            const root = makeTempDir();
            writeFileSync(resolve(root, "package.json"), JSON.stringify({ name: "tmp" }));
            process.env.LOOM_PACKAGE_ROOT = root;
            vi.resetModules();
            try {
                const mod = await import("@/lib/cli/next-runtime");
                const result = mod.resolveNextBin();

                expect(exitSpy).toHaveBeenCalledWith(1);
                expect(errorSpy).toHaveBeenCalledWith("Couldn't locate the `next` binary.");
                expect(errorSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("reinstalling"))).toBe(true);
                expect(errorSpy.mock.calls.some((c: unknown[]) => String(c[0]) === "Details:")).toBe(true);
                // process.exit is mocked (non-terminating): the function falls off
                // the end of the try/catch with no further statement, so it
                // returns `undefined` rather than actually halting. Harmless here
                // since nothing dereferences the result inside resolveNextBin
                // itself — but see runNext's "not-found propagation" test below
                // for the caller-side consequence.
                expect(result).toBeUndefined();
            } finally {
                cleanupTempDir(root);
                vi.resetModules();
            }
        });
    });

    describe("runNext", () => {
        it("spawns `node <nextBin> <mode>` with cwd=PACKAGE_ROOT and no -p/-H when nothing resolves", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});

            expect(spawn).toHaveBeenCalledTimes(1);
            const [command, args, options] = vi.mocked(spawn).mock.calls[0];
            expect(command).toBe(process.execPath);
            expect(args[0]).toContain("next");
            expect(args).toEqual([expect.stringContaining("next"), "start"]);
            expect(args).not.toContain("-p");
            expect(args).not.toContain("-H");
            expect(options).toMatchObject({ cwd: PACKAGE_ROOT, stdio: "inherit" });
            expect(options).toHaveProperty("env", process.env);
        });

        it("runs ensureExternalAliases only for mode=start, not mode=dev", () => {
            const child1 = makeFakeChild();
            vi.mocked(spawn).mockReturnValueOnce(child1 as never);
            runNext("start", {});
            expect(ensureExternalAliases).toHaveBeenCalledTimes(1);

            vi.mocked(ensureExternalAliases).mockClear();
            const child2 = makeFakeChild();
            vi.mocked(spawn).mockReturnValueOnce(child2 as never);
            runNext("dev", {});
            expect(ensureExternalAliases).not.toHaveBeenCalled();
        });

        it("always runs the config preflight", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            runNext("dev", {});
            expect(preflightFromConfig).toHaveBeenCalledTimes(1);
        });

        it("logs the loaded config path with applied env vars when preflight found a file", () => {
            vi.mocked(preflightFromConfig).mockReturnValue({
                path: "/cfg/loom.config.yaml",
                cfg: {} as never,
                applied: ["LOOM_SERVER_PORT", "LOOM_ADMIN_PASSWORD"],
            });
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});

            expect(logSpy).toHaveBeenCalledWith(
                "[loom] loaded config from /cfg/loom.config.yaml (env: LOOM_SERVER_PORT, LOOM_ADMIN_PASSWORD)",
            );
        });

        it("logs the config path with no parenthetical when nothing was applied", () => {
            vi.mocked(preflightFromConfig).mockReturnValue({
                path: "/cfg/loom.config.yaml",
                cfg: {} as never,
                applied: [],
            });
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});

            expect(logSpy).toHaveBeenCalledWith("[loom] loaded config from /cfg/loom.config.yaml");
        });

        it("does not log anything about config when preflight found no file", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            runNext("start", {});
            expect(logSpy).not.toHaveBeenCalled();
        });

        it("passes -p/-H when opts.port/opts.hostname are given", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", { port: "4000", hostname: "127.0.0.1" });

            const [, args] = vi.mocked(spawn).mock.calls[0];
            expect(args).toEqual(expect.arrayContaining(["-p", "4000", "-H", "127.0.0.1"]));
        });

        it("falls back to LOOM_SERVER_PORT when opts.port is absent", () => {
            process.env.LOOM_SERVER_PORT = "5000";
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});

            const [, args] = vi.mocked(spawn).mock.calls[0];
            expect(args).toEqual(expect.arrayContaining(["-p", "5000"]));
        });

        it("falls back to PORT when opts.port and LOOM_SERVER_PORT are both absent", () => {
            process.env.PORT = "6000";
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});

            const [, args] = vi.mocked(spawn).mock.calls[0];
            expect(args).toEqual(expect.arrayContaining(["-p", "6000"]));
        });

        it("opts.port wins over both env fallbacks", () => {
            process.env.LOOM_SERVER_PORT = "5000";
            process.env.PORT = "6000";
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", { port: "9999" });

            const [, args] = vi.mocked(spawn).mock.calls[0];
            expect(args).toEqual(expect.arrayContaining(["-p", "9999"]));
            expect(args).not.toContain("5000");
            expect(args).not.toContain("6000");
        });

        it("falls back to LOOM_SERVER_HOSTNAME when opts.hostname is absent", () => {
            process.env.LOOM_SERVER_HOSTNAME = "example.local";
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});

            const [, args] = vi.mocked(spawn).mock.calls[0];
            expect(args).toEqual(expect.arrayContaining(["-H", "example.local"]));
        });

        it("sets LOOM_USER_CWD and LOOM_PACKAGE_ROOT on process.env before spawning", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            delete process.env.LOOM_USER_CWD;

            runNext("start", {});

            expect(process.env.LOOM_PACKAGE_ROOT).toBe(PACKAGE_ROOT);
            expect(process.env.LOOM_USER_CWD).toBeDefined();
        });

        it("propagates the child's numeric exit code via process.exit", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});
            child.emit("exit", 7);

            expect(exitSpy).toHaveBeenCalledWith(7);
        });

        it("propagates exit code 0 unchanged", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("start", {});
            child.emit("exit", 0);

            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it("falls back to exit code 0 when the child exits with a null code (signal kill)", () => {
            const child = makeFakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);

            runNext("dev", {});
            child.emit("exit", null);

            expect(exitSpy).toHaveBeenCalledWith(0);
        });
    });
});
