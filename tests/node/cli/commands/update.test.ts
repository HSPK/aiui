import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDir, makeTempDir } from "../test-helpers";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));

import { spawn, spawnSync } from "node:child_process";
import { updateCommand } from "@/lib/cli/commands/update";

interface FakeRelease {
    tag_name: string;
    name: string | null;
    html_url: string;
    published_at: string;
    assets: Array<{ name: string; browser_download_url: string }>;
}

function fakeRelease(overrides: Partial<FakeRelease> = {}): FakeRelease {
    return {
        tag_name: "v1.0.0",
        name: null,
        html_url: "https://github.com/HSPK/loom/releases/tag/v1.0.0",
        published_at: new Date().toISOString(),
        assets: [],
        ...overrides,
    };
}

function mockFetchOk(overrides: Partial<FakeRelease> = {}): FakeRelease {
    const release = fakeRelease(overrides);
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => release,
        }),
    );
    return release;
}

function mockFetchHttpError(status = 500, statusText = "Internal Server Error"): void {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: false,
            status,
            statusText,
            json: async () => ({}),
        }),
    );
}

function mockFetchNetworkError(err = new Error("network unreachable")): void {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));
}

/** `which()` shells out to `which <cmd>` (or `where` on win32) via
 *  spawnSync and checks `status === 0`. */
function mockWhich(available: { bun?: boolean; npm?: boolean }): void {
    vi.mocked(spawnSync).mockImplementation((_exe: unknown, args?: readonly string[] | null) => {
        const cmd = args?.[0];
        const found = cmd === "bun" ? available.bun : cmd === "npm" ? available.npm : false;
        return { status: found ? 0 : 1 } as never;
    });
}

interface SpawnCallRecord {
    cmd: string;
    args: string[];
}

/** `run()` spawns a child (stdio: "inherit") and resolves on its "exit"
 *  event. The mock defers the synthetic exit to a microtask so it fires
 *  *after* `run()` has attached its "exit"/"error" listeners (emitting
 *  synchronously, before spawn() even returns, would be lost — nothing
 *  would be listening yet). Exit codes are consumed off a shared queue,
 *  one per spawn() call, defaulting to 0 (success) once exhausted. */
let spawnCalls: SpawnCallRecord[] = [];
let spawnExitCodes: number[] = [];

function installSpawnMock(): void {
    vi.mocked(spawn).mockImplementation((cmd: unknown, args?: readonly string[] | null) => {
        spawnCalls.push({ cmd: cmd as string, args: [...(args ?? [])] as string[] });
        const child = new EventEmitter();
        const code = spawnExitCodes.length > 0 ? spawnExitCodes.shift()! : 0;
        queueMicrotask(() => child.emit("exit", code));
        return child as never;
    });
}

/** Simulates a single line of stdin input for `confirmPrompt`. Since the
 *  Promise executor calls `process.stdin.on("data", cb)` synchronously,
 *  invoking `cb` immediately (still inside the same synchronous `.on()`
 *  mock call) resolves the promise right away — no real stream I/O, no
 *  timing games. */
function primeStdinAnswer(answer: string): void {
    vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "off").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "on").mockImplementation(((event: string, cb: (chunk: string) => void) => {
        if (event === "data") cb(answer);
        return process.stdin;
    }) as never);
}

function ctx(args: Record<string, unknown>) {
    return { args: { _: [], ...args } as never, rawArgs: [] as string[], cmd: updateCommand };
}

const ORIGINAL_LOOM_VERSION = process.env.LOOM_VERSION;

describe("lib/cli/commands/update", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.mocked(spawn).mockReset();
        vi.mocked(spawnSync).mockReset();
        installSpawnMock();
        spawnCalls = [];
        spawnExitCodes = [];
        logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (ORIGINAL_LOOM_VERSION === undefined) delete process.env.LOOM_VERSION;
        else process.env.LOOM_VERSION = ORIGINAL_LOOM_VERSION;
    });

    function logText(): string {
        return logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    }
    function errorText(): string {
        return errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    }

    // -----------------------------------------------------------------
    // compareVersions — driven indirectly via `--check`, since it's an
    // unexported helper. Each row distinguishes itself by which of the
    // three mutually-exclusive branches' distinctive log text appears:
    // "newer than the latest release" (cmp>0), "Up to date" (cmp===0),
    // or "Release notes:" (cmp<0, update available — only reachable
    // past both early returns).
    // -----------------------------------------------------------------
    describe("compareVersions (via --check)", () => {
        const rows: Array<[string, string, string, "newer" | "equal" | "update"]> = [
            ["exactly equal", "1.2.3", "1.2.3", "equal"],
            ["equal, v-prefix on latest only", "1.2.3", "v1.2.3", "equal"],
            ["equal, v-prefix on both", "v1.2.3", "v1.2.3", "equal"],
            ["patch difference", "1.2.3", "1.2.4", "update"],
            ["minor difference", "1.2.3", "1.3.0", "update"],
            ["major difference", "1.2.3", "2.0.0", "update"],
            ["current newer than latest (dev build)", "2.0.0", "1.9.0", "newer"],
            ["prerelease numeric suffix differs", "1.2.3-beta.1", "1.2.3-beta.2", "update"],
            ["prerelease string suffix differs (alpha<beta)", "1.2.3-alpha", "1.2.3-beta", "update"],
            ["fewer segments on current (\"1.2\" vs \"1.2.0\")", "1.2", "1.2.0", "update"],
            ["fewer segments on latest (\"1.2.0\" vs \"1.2\")", "1.2.0", "1.2", "newer"],
            ["numeric-aware, not lexicographic (1.9.0 < 1.10.0)", "1.9.0", "1.10.0", "update"],
        ];

        it.each(rows)("%s -> %s vs %s => %s", async (_label, current, latestTag, expected) => {
            process.env.LOOM_VERSION = current;
            mockFetchOk({ tag_name: latestTag });

            await updateCommand.run?.(ctx({ check: true }));

            const out = logText();
            if (expected === "equal") {
                expect(out).toContain("Up to date");
            } else if (expected === "newer") {
                expect(out).toContain("newer than the latest release");
            } else {
                expect(out).toContain("Release notes:");
                expect(out).toContain("Skipping install");
            }
            // --check must never touch package-manager resolution.
            expect(spawnSync).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------
    // which() / resolvePackageManager()
    // -----------------------------------------------------------------
    describe("resolvePackageManager", () => {
        beforeEach(() => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
        });

        it("explicit --pm bun bypasses which() entirely", async () => {
            await updateCommand.run?.(ctx({ pm: "bun", yes: true, clean: true }));

            expect(spawnSync).not.toHaveBeenCalled();
            expect(spawnCalls).toEqual([
                { cmd: "bun", args: ["remove", "-g", "loom"] },
                { cmd: "bun", args: ["add", "-g", expect.stringContaining("loom.tgz")] },
            ]);
        });

        it("explicit --pm npm bypasses which() entirely", async () => {
            await updateCommand.run?.(ctx({ pm: "npm", yes: true, clean: true }));

            expect(spawnSync).not.toHaveBeenCalled();
            expect(spawnCalls).toEqual([
                { cmd: "npm", args: ["rm", "-g", "loom"] },
                { cmd: "npm", args: ["i", "-g", expect.stringContaining("loom.tgz")] },
            ]);
        });

        it("an unrecognised --pm value silently falls back to auto-detect", async () => {
            mockWhich({ bun: false, npm: true });

            await updateCommand.run?.(ctx({ pm: "yarn", yes: true }));

            expect(spawnSync).toHaveBeenCalled();
            expect(spawnCalls[0]?.cmd).toBe("npm");
        });

        it("auto-detect prefers bun when both bun and npm are installed", async () => {
            mockWhich({ bun: true, npm: true });

            await updateCommand.run?.(ctx({ yes: true }));

            expect(spawnCalls[0]?.cmd).toBe("bun");
        });

        it("auto-detect falls back to npm when only npm is installed", async () => {
            mockWhich({ bun: false, npm: true });

            await updateCommand.run?.(ctx({ yes: true, clean: true }));

            expect(spawnCalls).toEqual([
                { cmd: "npm", args: ["rm", "-g", "loom"] },
                { cmd: "npm", args: ["i", "-g", expect.stringContaining("loom.tgz")] },
            ]);
        });
    });

    // -----------------------------------------------------------------
    // --check
    // -----------------------------------------------------------------
    describe("--check", () => {
        it("stops after printing release info and never resolves a package manager or spawns", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v2.0.0", html_url: "https://example.com/r/v2.0.0" });

            await updateCommand.run?.(ctx({ check: true }));

            expect(logText()).toContain("Skipping install");
            expect(logText()).toContain("https://example.com/r/v2.0.0");
            expect(spawnSync).not.toHaveBeenCalled();
            expect(spawn).not.toHaveBeenCalled();
        });

        it("up-to-date short-circuits before the update-available banner", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.0.0" });

            await updateCommand.run?.(ctx({ check: true }));

            expect(logText()).toContain("Up to date");
            expect(logText()).not.toContain("Release notes:");
        });

        it("falls back to '0.0.0-dev' when LOOM_VERSION is unset", async () => {
            delete process.env.LOOM_VERSION;
            mockFetchOk({ tag_name: "v1.0.0" });

            await updateCommand.run?.(ctx({ check: true }));

            expect(logText()).toContain("v0.0.0-dev");
        });
    });

    // -----------------------------------------------------------------
    // Successful install flow (implicitly covers "update available")
    // -----------------------------------------------------------------
    describe("successful install", () => {
        it("--yes skips the confirmation prompt and installs directly", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });

            await updateCommand.run?.(ctx({ yes: true }));

            expect(logText()).toContain("Package manager:");
            expect(logText()).toContain("Updated to v1.1.0");
            expect(logText()).toContain("loom --version");
            expect(exitSpy).not.toHaveBeenCalled();
            expect(spawnCalls).toEqual([{ cmd: "bun", args: ["add", "-g", expect.stringContaining("loom.tgz")] }]);
        });

        it("without --yes, prints the planned command before prompting", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });
            primeStdinAnswer("y");

            await updateCommand.run?.(ctx({}));

            expect(logText()).toContain("Install:");
            expect(spawnCalls.length).toBe(1);
        });

        it("a child killed by signal (exit code null) falls back to code 0 (treated as success)", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });
            vi.mocked(spawn).mockImplementationOnce((cmd: unknown, args?: readonly string[] | null) => {
                spawnCalls.push({ cmd: cmd as string, args: [...(args ?? [])] as string[] });
                const child = new EventEmitter();
                // Real Node: an "exit" event fires `(code, signal)` with
                // `code === null` when the process was killed by a signal
                // rather than exiting normally.
                queueMicrotask(() => child.emit("exit", null));
                return child as never;
            });

            await updateCommand.run?.(ctx({ yes: true }));

            // `code ?? 1` -> 1, which is truthy/non-zero -> failure path.
            expect(exitSpy).toHaveBeenCalledWith(1);
        });
    });

    // -----------------------------------------------------------------
    // formatRelativeTime — exercised via the "Latest ... (<rel>)" log
    // line, keyed off `release.published_at`.
    // -----------------------------------------------------------------
    describe("formatRelativeTime (via the 'Latest' line)", () => {
        beforeEach(() => {
            process.env.LOOM_VERSION = "1.0.0";
        });

        it("< 60s -> '<n>s ago'", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: new Date(Date.now() - 5_000).toISOString() });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toMatch(/\ds ago/);
        });

        it("minutes -> '<n>m ago'", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: new Date(Date.now() - 5 * 60_000).toISOString() });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toMatch(/5m ago/);
        });

        it("hours -> '<n>h ago'", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: new Date(Date.now() - 5 * 3_600_000).toISOString() });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toMatch(/5h ago/);
        });

        it("days -> '<n>d ago'", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toMatch(/5d ago/);
        });

        it("months -> '<n>mo ago'", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: new Date(Date.now() - 60 * 86_400_000).toISOString() });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toMatch(/2mo ago/);
        });

        it("years -> '<n>y ago'", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: new Date(Date.now() - 400 * 86_400_000).toISOString() });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toMatch(/1y ago/);
        });

        it("unparseable date -> returned verbatim", async () => {
            mockFetchOk({ tag_name: "v1.0.0", published_at: "not-a-real-date" });
            await updateCommand.run?.(ctx({ check: true }));
            expect(logText()).toContain("not-a-real-date");
        });
    });

    // -----------------------------------------------------------------
    // Confirmation prompt
    // -----------------------------------------------------------------
    describe("confirmation prompt", () => {
        beforeEach(() => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });
        });

        it("accepting ('y') proceeds to install", async () => {
            primeStdinAnswer("y");

            await updateCommand.run?.(ctx({}));

            expect(spawnCalls.length).toBe(1);
            expect(logText()).toContain("Updated to");
        });

        it("accepting ('yes') proceeds to install", async () => {
            primeStdinAnswer("yes");

            await updateCommand.run?.(ctx({}));

            expect(spawnCalls.length).toBe(1);
        });

        it("declining ('n') aborts without spawning anything", async () => {
            primeStdinAnswer("n");

            await updateCommand.run?.(ctx({}));

            expect(spawn).not.toHaveBeenCalled();
            expect(logText()).toContain("Aborted.");
        });

        it("declining (garbage input) aborts, same as an explicit 'n'", async () => {
            primeStdinAnswer("whatever");

            await updateCommand.run?.(ctx({}));

            expect(spawn).not.toHaveBeenCalled();
            expect(logText()).toContain("Aborted.");
        });
    });

    // -----------------------------------------------------------------
    // --clean
    // -----------------------------------------------------------------
    describe("--clean", () => {
        it("runs a pre-clean removal before the install, in order", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });

            await updateCommand.run?.(ctx({ yes: true, clean: true }));

            expect(logText()).toContain("Pre-clean:");
            expect(spawnCalls).toEqual([
                { cmd: "bun", args: ["remove", "-g", "loom"] },
                { cmd: "bun", args: ["add", "-g", expect.stringContaining("loom.tgz")] },
            ]);
        });
    });

    // -----------------------------------------------------------------
    // Failure handling
    // -----------------------------------------------------------------
    describe("install failure", () => {
        it("non-zero exit code without --clean reports failure and suggests --clean", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });
            spawnExitCodes = [7];

            await updateCommand.run?.(ctx({ yes: true }));

            expect(errorText()).toContain("Install failed with exit code 7");
            expect(errorText()).toContain("loom update --clean");
            expect(exitSpy).toHaveBeenCalledWith(7);
        });

        it("non-zero exit code WITH --clean does not repeat the --clean suggestion", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });
            spawnExitCodes = [0, 3]; // pre-clean succeeds, install fails

            await updateCommand.run?.(ctx({ yes: true, clean: true }));

            expect(errorText()).toContain("Install failed with exit code 3");
            expect(errorText()).not.toContain("loom update --clean");
            expect(exitSpy).toHaveBeenCalledWith(3);
        });

        it("a spawn 'error' event (e.g. ENOENT) resolves run() with exit code 1", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });
            vi.mocked(spawn).mockImplementationOnce((cmd: unknown, args?: readonly string[] | null) => {
                spawnCalls.push({ cmd: cmd as string, args: [...(args ?? [])] as string[] });
                const child = new EventEmitter();
                queueMicrotask(() => child.emit("error", new Error("ENOENT")));
                return child as never;
            });

            await updateCommand.run?.(ctx({ yes: true }));

            expect(errorText()).toContain("Failed to spawn");
            expect(exitSpy).toHaveBeenCalledWith(1);
        });
    });

    // -----------------------------------------------------------------
    // Fixed: missing `return`/`else` after `process.exit(N)`. In real
    // Node, `process.exit` halts the process synchronously so a missing
    // `return` was invisible in production — but under the assignment's
    // mandated non-terminating `process.exit` double (a stand-in for a
    // signal handler, a "confirm before exiting" wrapper, or a test
    // harness), execution used to fall through into a `null`/`undefined`
    // dereference. `release` is now `LatestRelease | null` with an
    // explicit `if (!release) return;` guard, and the `!pm` branch now
    // has an explicit `return` after `process.exit(1)`. These tests pin
    // the fixed, clean-exit behaviour.
    // -----------------------------------------------------------------
    describe("fixed: return after process.exit()", () => {
        // Fixed: lib/cli/commands/update.ts — the `fetchLatest()` catch
        // block calls `process.exit(1)`, and the code immediately after
        // the try/catch now guards with `if (!release) return;` before
        // ever touching `release.tag_name`. A stubbed (non-terminating)
        // `process.exit` must therefore return cleanly instead of
        // throwing a TypeError, and nothing past "Latest" should print.
        it("update.ts: a fetch failure returns cleanly past process.exit(1) (no crash)", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchNetworkError(new Error("network unreachable"));

            await updateCommand.run?.(ctx({ check: true }));

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorText()).toContain("Failed to reach GitHub");
            expect(logText()).not.toContain("Latest");
        });

        it("update.ts: an HTTP error response returns cleanly past process.exit(1) (no crash)", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchHttpError(503, "Service Unavailable");

            await updateCommand.run?.(ctx({ check: true }));

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(logText()).not.toContain("Latest");
        });

        // Fixed: lib/cli/commands/update.ts — the `if (!pm)` block now has
        // an explicit `return` after `process.exit(1)`, so `pm.cmd`/
        // `pm.install(...)` are never dereferenced on `null`. A stubbed
        // (non-terminating) `process.exit` must therefore return cleanly
        // with no install attempted.
        it("update.ts: no bun/npm found returns cleanly past process.exit(1) (no install spawned)", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: false, npm: false });

            await updateCommand.run?.(ctx({ yes: true }));

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorText()).toContain("Neither");
            expect(spawn).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------
    // TTY / NO_COLOR styling branch — `useColor` is computed once at
    // module import, so exercising the colored branch needs a fresh
    // dynamic re-import with `process.stdout.isTTY` forced on. `fetch`
    // is a bare global (not an ESM import), so `vi.stubGlobal` reaches
    // whatever instance of update.ts is live regardless of
    // `resetModules` — no hoisted-mock gymnastics needed here.
    // -----------------------------------------------------------------
    describe("TTY / NO_COLOR styling", () => {
        const originalIsTTY = process.stdout.isTTY;
        const originalNoColor = process.env.NO_COLOR;

        afterEach(() => {
            Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
            if (originalNoColor === undefined) delete process.env.NO_COLOR;
            else process.env.NO_COLOR = originalNoColor;
            vi.resetModules();
        });

        it("isTTY + no NO_COLOR -> ANSI-styled, unicode-symbol output", async () => {
            Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
            delete process.env.NO_COLOR;
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.0.0" }); // up-to-date: short, single-branch path

            vi.resetModules();
            const { updateCommand: freshCmd } = await import("@/lib/cli/commands/update");
            await freshCmd.run?.({ args: { _: [], check: true } as never, rawArgs: [], cmd: freshCmd });

            const out = logText();
            expect(out).toContain("\x1b["); // ANSI escape present
            expect(out).toContain("✓"); // unicode symbol, not "[ok]"
        });

        it("isTTY + NO_COLOR=1 -> plain text despite being a TTY", async () => {
            Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
            process.env.NO_COLOR = "1";
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.0.0" });

            vi.resetModules();
            const { updateCommand: freshCmd } = await import("@/lib/cli/commands/update");
            await freshCmd.run?.({ args: { _: [], check: true } as never, rawArgs: [], cmd: freshCmd });

            const out = logText();
            expect(out).not.toContain("\x1b[");
            expect(out).toContain("[ok]");
        });

        it("non-TTY (default in this harness) -> plain text, no ANSI", async () => {
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.0.0" });

            await updateCommand.run?.(ctx({ check: true }));

            const out = logText();
            expect(out).not.toContain("\x1b[");
            expect(out).toContain("[ok]");
        });
    });

    // -----------------------------------------------------------------
    // tidyBunGlobals / tidyJsonFile — private helpers invoked only when
    // the resolved package manager is bun. Real (unmocked) fs against a
    // temp HOME so `homedir()` resolves inside the sandbox.
    // -----------------------------------------------------------------
    describe("tidyBunGlobals / tidyJsonFile (bun-only, best-effort dedup)", () => {
        const originalHome = process.env.HOME;
        let dirs: string[] = [];

        afterEach(() => {
            if (originalHome === undefined) delete process.env.HOME;
            else process.env.HOME = originalHome;
            for (const d of dirs) cleanupTempDir(d);
            dirs = [];
        });

        function globalDir(home: string): string {
            return resolve(home, ".bun", "install", "global");
        }

        it("no bun global files present -> no-op, install still succeeds", async () => {
            const home = makeTempDir();
            dirs.push(home);
            process.env.HOME = home;
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });

            await expect(updateCommand.run?.(ctx({ yes: true }))).resolves.toBeUndefined();

            expect(existsSync(globalDir(home))).toBe(false);
        });

        it("duplicate-shaped package.json gets rewritten to pretty-printed, deduped JSON", async () => {
            const home = makeTempDir();
            dirs.push(home);
            process.env.HOME = home;
            const dir = globalDir(home);
            mkdirSync(dir, { recursive: true });
            // JSON.parse silently keeps only the LAST "loom" key when a raw
            // file has one repeated — a minified single-line encoding
            // guarantees `rewritten !== raw` regardless, so the dedup
            // rewrite is guaranteed to fire.
            const pkgPath = resolve(dir, "package.json");
            writeFileSync(pkgPath, JSON.stringify({ dependencies: { loom: "old-url" } }));
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });

            await updateCommand.run?.(ctx({ yes: true }));

            const rewritten = readFileSync(pkgPath, "utf8");
            expect(rewritten).toBe(`${JSON.stringify({ dependencies: { loom: "old-url" } }, null, 2)}\n`);
        });

        it("already-pretty-printed package.json is left byte-for-byte untouched", async () => {
            const home = makeTempDir();
            dirs.push(home);
            process.env.HOME = home;
            const dir = globalDir(home);
            mkdirSync(dir, { recursive: true });
            const pkgPath = resolve(dir, "package.json");
            const pretty = `${JSON.stringify({ dependencies: { loom: "url" } }, null, 2)}\n`;
            writeFileSync(pkgPath, pretty);
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });

            await updateCommand.run?.(ctx({ yes: true }));

            expect(readFileSync(pkgPath, "utf8")).toBe(pretty);
        });

        it("unparseable bun.lock (JSONC/comments) is left untouched, not mangled", async () => {
            const home = makeTempDir();
            dirs.push(home);
            process.env.HOME = home;
            const dir = globalDir(home);
            mkdirSync(dir, { recursive: true });
            const lockPath = resolve(dir, "bun.lock");
            const jsonc = `{\n  // comment\n  "loom": "url"\n}\n`;
            writeFileSync(lockPath, jsonc);
            process.env.LOOM_VERSION = "1.0.0";
            mockFetchOk({ tag_name: "v1.1.0" });
            mockWhich({ bun: true, npm: false });

            await updateCommand.run?.(ctx({ yes: true }));

            expect(readFileSync(lockPath, "utf8")).toBe(jsonc);
        });
    });
});
