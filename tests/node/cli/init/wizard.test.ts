import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { cleanupTempDir, makeTempDir } from "../test-helpers";

// wizard.ts pulls `USER_CWD` from `../paths`, which snapshots
// `process.cwd()` at *import* time. The docker harness bind-mounts the
// real repo at /app, so a careless "project default path" write would
// land a real `loom.config.yaml` inside the checked-out repo. Every test
// below therefore `chdir`s into its own mkdtemp'd directory and does a
// `vi.resetModules()` + dynamic re-import so `USER_CWD` is recomputed
// against the throwaway directory before any code under test runs.

const CANCEL = Symbol("cancel");

// Stable, hoisted mock singletons: `vi.mock` factories are re-invoked on
// every `vi.resetModules()`, so a plain `vi.fn()` declared inline in the
// factory would produce a *new* function identity each time — desyncing
// this file's static `import { select, ... } from "@clack/prompts"`
// (resolved once, at file load) from whatever wizard.ts's fresh
// re-imports see. Spreading from a `vi.hoisted()` singleton keeps every
// re-import wired to the exact same fn objects this file configures.
const clackMocks = vi.hoisted(() => ({
    select: vi.fn(),
    text: vi.fn(),
    password: vi.fn(),
    confirm: vi.fn(),
    group: vi.fn(),
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    cancel: vi.fn(),
    log: {
        message: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        step: vi.fn(),
        warn: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("@clack/prompts", () => ({
    ...clackMocks,
    isCancel: (v: unknown) => v === CANCEL,
}));

const nextRuntimeMocks = vi.hoisted(() => ({ runNext: vi.fn() }));
vi.mock("@/lib/cli/next-runtime", () => nextRuntimeMocks);

import { cancel, confirm, group, intro, log, note, outro, password, select, text } from "@clack/prompts";
import { runNext } from "@/lib/cli/next-runtime";

/** `group()`'s real implementation runs each field's factory in order and
 *  collects the results keyed by field name — exactly what wizard.ts
 *  needs (username -> passwordRef -> providerSpec -> portStr ->
 *  hostnameStr, per the object's own key order, which V8 preserves for
 *  string keys). `onCancel` is intentionally NOT invoked here: every
 *  field wizard.ts passes to `group()` is wrapped in `ask()`, which
 *  already throws/exits on a cancel sentinel before `group` could ever
 *  see one, so the real `onCancel` callback is unreachable in practice. */
function installSequentialGroup(): void {
    clackMocks.group.mockImplementation(async (prompts: Record<string, () => Promise<unknown>>) => {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(prompts)) {
            result[key] = await prompts[key]();
        }
        return result;
    });
}

const ORIGINAL_CWD = process.cwd();
let dirs: string[] = [];

function newRoot(): string {
    const d = makeTempDir();
    dirs.push(d);
    return d;
}

/** chdir into `cwd`, reset the module graph, and dynamically re-import
 *  wizard.ts so `USER_CWD` is recomputed against it. */
async function loadWizard(cwd: string) {
    process.chdir(cwd);
    vi.resetModules();
    return import("@/lib/cli/init/wizard");
}

describe("lib/cli/init/wizard", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    const originalXdg = process.env.XDG_CONFIG_HOME;
    const originalHome = process.env.HOME;

    beforeEach(() => {
        vi.resetAllMocks();
        installSequentialGroup();
        // Throwing by default: cleanly halts execution on the (real,
        // production-correct) cancellation / abort paths instead of
        // falling through as if `process.exit` were a no-op. The one
        // test that needs the non-terminating shape (proving the
        // wizard.ts:37 bug) overrides this per-test.
        exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Error(`__PROCESS_EXIT_${code}__`);
        });
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
        stdoutSpy.mockRestore();
        process.chdir(ORIGINAL_CWD);
        for (const d of dirs) cleanupTempDir(d);
        dirs = [];
        if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = originalXdg;
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        vi.resetModules();
    });

    // -----------------------------------------------------------------
    // resolveOutPath
    // -----------------------------------------------------------------
    describe("resolveOutPath", () => {
        it("explicitOut absolute path is returned unchanged regardless of cwd", async () => {
            const cwd = newRoot();
            const abs = resolve(newRoot(), "somewhere", "custom.yaml");
            const { resolveOutPath } = await loadWizard(cwd);

            expect(resolveOutPath({ explicitOut: abs })).toBe(abs);
        });

        it("explicitOut relative path resolves against USER_CWD", async () => {
            const cwd = newRoot();
            const { resolveOutPath } = await loadWizard(cwd);

            expect(resolveOutPath({ explicitOut: "sub/custom.yaml" })).toBe(resolve(cwd, "sub/custom.yaml"));
        });

        it("user:true with XDG_CONFIG_HOME set resolves to <xdg>/loom.yaml", async () => {
            const cwd = newRoot();
            const xdg = join(newRoot(), "xdg");
            process.env.XDG_CONFIG_HOME = xdg;
            const { resolveOutPath } = await loadWizard(cwd);

            expect(resolveOutPath({ user: true })).toBe(resolve(xdg, "loom.yaml"));
        });

        it("user:true without XDG_CONFIG_HOME falls back to homedir()/.config/loom.yaml", async () => {
            const cwd = newRoot();
            delete process.env.XDG_CONFIG_HOME;
            const home = join(newRoot(), "home");
            process.env.HOME = home;
            const { resolveOutPath } = await loadWizard(cwd);

            expect(resolveOutPath({ user: true })).toBe(resolve(home, ".config", "loom.yaml"));
        });

        it("no explicitOut/user -> project default <USER_CWD>/loom.config.yaml", async () => {
            const cwd = newRoot();
            const { resolveOutPath } = await loadWizard(cwd);

            expect(resolveOutPath({})).toBe(resolve(cwd, "loom.config.yaml"));
        });
    });

    // -----------------------------------------------------------------
    // writeOut
    // -----------------------------------------------------------------
    describe("writeOut", () => {
        it("creates parent dirs, writes with mode 0600, and logs success", async () => {
            const cwd = newRoot();
            const { writeOut } = await loadWizard(cwd);
            const outPath = resolve(cwd, "nested", "sub", "loom.config.yaml");

            writeOut(outPath, "master_key: abc\n");

            expect(readFileSync(outPath, "utf8")).toBe("master_key: abc\n");
            expect(statSync(outPath).mode & 0o777).toBe(0o600);
            expect(log.success).toHaveBeenCalledWith(`Wrote ${outPath}`);
        });
    });

    // -----------------------------------------------------------------
    // Non-interactive paths: --print / --yes / --force
    // -----------------------------------------------------------------
    describe("runInteractiveInit: non-interactive paths", () => {
        it("--print writes the template to stdout and never touches the filesystem", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            await runInteractiveInit({ print: true });

            expect(stdoutSpy).toHaveBeenCalledTimes(1);
            const written = stdoutSpy.mock.calls[0][0] as string;
            expect(written).toContain("master_key:");
            expect(parseYaml(written)).toHaveProperty("master_key");
            expect(existsSync(resolve(cwd, "loom.config.yaml"))).toBe(false);
            expect(intro).not.toHaveBeenCalled();
            expect(group).not.toHaveBeenCalled();
        });

        it("--yes on a fresh directory writes the default template to the project path", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            await runInteractiveInit({ yes: true });

            const outPath = resolve(cwd, "loom.config.yaml");
            expect(existsSync(outPath)).toBe(true);
            expect(statSync(outPath).mode & 0o777).toBe(0o600);
            const parsed = parseYaml(readFileSync(outPath, "utf8"));
            expect(parsed).toHaveProperty("master_key");
            expect(parsed.admin).toEqual({ username: "admin", password: "${LOOM_ADMIN_PASSWORD}" });
            expect(intro).not.toHaveBeenCalled();
        });

        it("--yes --out <relative> writes under USER_CWD at the given relative path", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            await runInteractiveInit({ yes: true, explicitOut: "custom/config.yaml" });

            expect(existsSync(resolve(cwd, "custom/config.yaml"))).toBe(true);
        });

        it("--yes --user writes to <XDG_CONFIG_HOME>/loom.yaml", async () => {
            const cwd = newRoot();
            const xdg = join(newRoot(), "xdg");
            process.env.XDG_CONFIG_HOME = xdg;
            const { runInteractiveInit } = await loadWizard(cwd);

            await runInteractiveInit({ yes: true, user: true });

            expect(existsSync(resolve(xdg, "loom.yaml"))).toBe(true);
        });

        it("--yes --force overwrites an existing file cleanly (no process.exit)", async () => {
            const cwd = newRoot();
            const outPath = resolve(cwd, "loom.config.yaml");
            writeFileSync(outPath, "old-content: true\n");
            const { runInteractiveInit } = await loadWizard(cwd);

            await runInteractiveInit({ yes: true, force: true });

            const content = readFileSync(outPath, "utf8");
            expect(content).not.toBe("old-content: true\n");
            expect(content).toContain("master_key:");
            expect(exitSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        });

        // --- Fixed: lib/cli/init/wizard.ts:37 -------------------------------
        // `if (existsSync(outPath) && !opts.force) { ...; process.exit(1); }
        // else { writeOut(...); }` is now a structural if/else, so a stubbed
        // (non-terminating) `process.exit` can no longer fall through into
        // the write. This test pins that: with `process.exit` stubbed to
        // return instead of halting, the pre-existing file must be left
        // byte-for-byte untouched and `writeOut` (proxied via the mocked
        // `log.success`, its only caller in this module) must never run.
        it("--yes on an existing file without --force leaves it untouched (no fall-through write)", async () => {
            const cwd = newRoot();
            const outPath = resolve(cwd, "loom.config.yaml");
            writeFileSync(outPath, "old-content: true\n");
            const { runInteractiveInit } = await loadWizard(cwd);
            // Non-terminating override: proves the refusal branch itself
            // (not just process.exit halting the process) skips the write.
            exitSpy.mockImplementation(() => undefined as never);

            await runInteractiveInit({ yes: true });

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Refusing to overwrite"));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--force"));
            expect(readFileSync(outPath, "utf8")).toBe("old-content: true\n");
            expect(log.success).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------
    // Full interactive flow
    // -----------------------------------------------------------------
    describe("runInteractiveInit: interactive flow", () => {
        it("happy path: custom path, defaults skipped, provider skipped, startNow=false", async () => {
            const cwd = newRoot();
            const outPath = resolve(newRoot(), "picked", "loom.config.yaml");
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("custom") // promptOutPath target
                .mockResolvedValueOnce("env") // admin password mode
                .mockResolvedValueOnce("skip"); // provider kind
            vi.mocked(text)
                .mockResolvedValueOnce(outPath) // promptOutPath's custom-path text()
                .mockResolvedValueOnce("alice") // username
                .mockResolvedValueOnce("3000") // port (default)
                .mockResolvedValueOnce("0.0.0.0"); // hostname (default)
            vi.mocked(confirm).mockResolvedValueOnce(false); // startNow

            await runInteractiveInit({});

            expect(intro).toHaveBeenCalledWith("Loom setup");
            expect(existsSync(outPath)).toBe(true);
            expect(statSync(outPath).mode & 0o777).toBe(0o600);
            const parsed = parseYaml(readFileSync(outPath, "utf8"));
            expect(parsed.admin).toEqual({ username: "alice", password: "${LOOM_ADMIN_PASSWORD}" });
            expect(parsed.server).toBeUndefined();

            const noteMsg = vi.mocked(note).mock.calls[0][0] as string;
            expect(noteMsg).toContain("export LOOM_ADMIN_PASSWORD=");
            expect(noteMsg).toContain("loom start");
            expect(noteMsg).not.toContain("api_key"); // no provider selected

            expect(outro).toHaveBeenCalledWith(`Config written to ${outPath}`);
            expect(runNext).not.toHaveBeenCalled();
        });

        it("custom port/hostname + inline admin password + openai provider(env) + startNow=true", async () => {
            const cwd = newRoot();
            const outPath = resolve(newRoot(), "loom.config.yaml");
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("custom") // promptOutPath target
                .mockResolvedValueOnce("inline") // admin password mode
                .mockResolvedValueOnce("openai") // provider kind
                .mockResolvedValueOnce("env"); // provider api key mode
            vi.mocked(text)
                .mockResolvedValueOnce(outPath) // promptOutPath's custom text
                .mockResolvedValueOnce("bob") // username
                .mockResolvedValueOnce("OPENAI_API_KEY") // provider env var name
                .mockResolvedValueOnce("4000") // port (custom)
                .mockResolvedValueOnce("127.0.0.1"); // hostname (custom)
            vi.mocked(password).mockResolvedValueOnce("superSecret1"); // admin inline password
            vi.mocked(confirm).mockResolvedValueOnce(true); // startNow

            await runInteractiveInit({});

            const parsed = parseYaml(readFileSync(outPath, "utf8"));
            expect(parsed.admin).toEqual({ username: "bob", password: "superSecret1" });
            expect(parsed.server).toEqual({ port: 4000, hostname: "127.0.0.1" });
            expect(parsed.providers).toEqual([
                {
                    name: "openai",
                    base_url: "https://api.openai.com/v1",
                    api_key: "${OPENAI_API_KEY}",
                    document_page: "https://platform.openai.com/docs",
                },
            ]);

            const noteMsg = vi.mocked(note).mock.calls[0][0] as string;
            // Admin password is a literal (doesn't start with "${") -> no export hint for it.
            expect(noteMsg).not.toContain("LOOM_ADMIN_PASSWORD");
            // Provider key IS an env reference -> export hint present.
            expect(noteMsg).toContain("export OPENAI_API_KEY=");
            expect(noteMsg).toContain("loom start");

            expect(runNext).toHaveBeenCalledWith("start", { port: "4000", hostname: "127.0.0.1" });
        });

        it("'project' outpath target resolves against USER_CWD", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("project")
                .mockResolvedValueOnce("env")
                .mockResolvedValueOnce("skip");
            vi.mocked(text)
                .mockResolvedValueOnce("admin")
                .mockResolvedValueOnce("3000")
                .mockResolvedValueOnce("0.0.0.0");
            vi.mocked(confirm).mockResolvedValueOnce(false);

            await runInteractiveInit({});

            expect(existsSync(resolve(cwd, "loom.config.yaml"))).toBe(true);
            // promptOutPath's "project" branch takes no extra text() prompt.
            expect(vi.mocked(text).mock.calls[0][0]).toMatchObject({ message: "Admin username" });
        });

        it("'user' outpath target resolves to <XDG_CONFIG_HOME>/loom.yaml", async () => {
            const cwd = newRoot();
            const xdg = join(newRoot(), "xdg");
            process.env.XDG_CONFIG_HOME = xdg;
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("user")
                .mockResolvedValueOnce("env")
                .mockResolvedValueOnce("skip");
            vi.mocked(text)
                .mockResolvedValueOnce("admin")
                .mockResolvedValueOnce("3000")
                .mockResolvedValueOnce("0.0.0.0");
            vi.mocked(confirm).mockResolvedValueOnce(false);

            await runInteractiveInit({});

            expect(existsSync(resolve(xdg, "loom.yaml"))).toBe(true);
        });

        it("declining the overwrite prompt aborts before group() and leaves the file untouched", async () => {
            const cwd = newRoot();
            const outPath = resolve(cwd, "loom.config.yaml");
            writeFileSync(outPath, "pristine: true\n");
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select).mockResolvedValueOnce("project"); // outpath target only
            vi.mocked(confirm).mockResolvedValueOnce(false); // decline overwrite

            await expect(runInteractiveInit({})).rejects.toThrow(/__PROCESS_EXIT_1__/);

            expect(cancel).toHaveBeenCalledWith("Aborted — existing config left untouched.");
            expect(group).not.toHaveBeenCalled();
            expect(readFileSync(outPath, "utf8")).toBe("pristine: true\n");
        });

        it("accepting the overwrite prompt proceeds and replaces the existing file", async () => {
            const cwd = newRoot();
            const outPath = resolve(cwd, "loom.config.yaml");
            writeFileSync(outPath, "pristine: true\n");
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("project")
                .mockResolvedValueOnce("env")
                .mockResolvedValueOnce("skip");
            vi.mocked(confirm)
                .mockResolvedValueOnce(true) // accept overwrite
                .mockResolvedValueOnce(false); // startNow
            vi.mocked(text)
                .mockResolvedValueOnce("admin")
                .mockResolvedValueOnce("3000")
                .mockResolvedValueOnce("0.0.0.0");

            await runInteractiveInit({});

            const content = readFileSync(outPath, "utf8");
            expect(content).not.toBe("pristine: true\n");
            expect(content).toContain("master_key:");
        });

        it("cancelling mid-group (username prompt) rejects and never writes a file", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select).mockResolvedValueOnce("project");
            vi.mocked(text).mockResolvedValueOnce(CANCEL as never); // username -> cancelled

            await expect(runInteractiveInit({})).rejects.toThrow(/__PROCESS_EXIT_1__/);

            expect(cancel).toHaveBeenCalledWith("Cancelled.");
            expect(existsSync(resolve(cwd, "loom.config.yaml"))).toBe(false);
        });

        // Every field passed to `group()` is wrapped in `ask()`, which
        // already bails on a cancel sentinel before `group()` could ever
        // decide to invoke its own `onCancel` — so the real `@clack/prompts`
        // never reaches this callback via wizard.ts's own usage. It's still
        // correctly wired though: this test drives the group mock to invoke
        // `onCancel` directly (as a defensive real implementation might, if
        // it detected a cancellation some other way) and asserts it produces
        // the same "Cancelled." abort as the rest of the cancellation paths.
        it("group()'s onCancel callback (defensive, unreachable via ask()) still bails cleanly", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select).mockResolvedValueOnce("project");
            vi.mocked(group).mockImplementationOnce(async (_prompts, opts) => {
                opts?.onCancel?.({ results: {} });
                return {};
            });

            await expect(runInteractiveInit({})).rejects.toThrow(/__PROCESS_EXIT_1__/);

            expect(cancel).toHaveBeenCalledWith("Cancelled.");
        });
    });

    // -----------------------------------------------------------------
    // Inline validator / prompt-shape coverage
    // -----------------------------------------------------------------
    describe("inline validators captured from the interactive flow", () => {
        async function driveHappyPathCapturingCalls(cwd: string) {
            const outPath = resolve(cwd, "loom.config.yaml");
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("project")
                .mockResolvedValueOnce("inline") // exercise the password() validator too
                .mockResolvedValueOnce("skip");
            vi.mocked(text)
                .mockResolvedValueOnce("admin")
                .mockResolvedValueOnce("3000")
                .mockResolvedValueOnce("0.0.0.0");
            vi.mocked(password).mockResolvedValueOnce("12345678");
            vi.mocked(confirm).mockResolvedValueOnce(false);

            await runInteractiveInit({});
            return outPath;
        }

        it("username validator requires >=2 trimmed chars; undefined passes through", async () => {
            const cwd = newRoot();
            await driveHappyPathCapturingCalls(cwd);

            const usernameCall = vi.mocked(text).mock.calls.find(
                (c) => (c[0] as { message?: string }).message === "Admin username",
            )![0] as { validate: (v?: string) => string | undefined };

            expect(usernameCall.validate("ab")).toBeUndefined();
            expect(usernameCall.validate(" a")).toBe("At least 2 characters");
            expect(usernameCall.validate("   ")).toBe("At least 2 characters");
            expect(usernameCall.validate(undefined)).toBeUndefined();
        });

        it("port validator requires digits only; undefined passes through", async () => {
            const cwd = newRoot();
            await driveHappyPathCapturingCalls(cwd);

            const portCall = vi.mocked(text).mock.calls.find(
                (c) => (c[0] as { message?: string }).message === "Port",
            )![0] as { validate: (v?: string) => string | undefined };

            expect(portCall.validate("3000")).toBeUndefined();
            expect(portCall.validate("abc")).toBe("Must be a number");
            expect(portCall.validate("12.5")).toBe("Must be a number");
            expect(portCall.validate("-5")).toBe("Must be a number");
            expect(portCall.validate(undefined)).toBeUndefined();
        });

        it("hostname prompt has no validate function at all (any string is accepted)", async () => {
            const cwd = newRoot();
            await driveHappyPathCapturingCalls(cwd);

            const hostnameCall = vi.mocked(text).mock.calls.find(
                (c) => (c[0] as { message?: string }).message === "Hostname",
            )![0] as { validate?: unknown };

            expect(hostnameCall.validate).toBeUndefined();
        });

        it("inline admin password validator requires >=8 chars; undefined passes through", async () => {
            const cwd = newRoot();
            await driveHappyPathCapturingCalls(cwd);

            const pwCall = vi.mocked(password).mock.calls[0][0] as {
                validate: (v?: string) => string | undefined;
            };

            expect(pwCall.validate("1234567")).toBe("Use at least 8 characters");
            expect(pwCall.validate("12345678")).toBeUndefined();
            expect(pwCall.validate(undefined)).toBeUndefined();
        });

        it("promptOutPath's custom-path text() uses USER_CWD/loom.config.yaml as placeholder", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("custom")
                .mockResolvedValueOnce("env")
                .mockResolvedValueOnce("skip");
            const customOut = resolve(cwd, "custom.yaml");
            vi.mocked(text)
                .mockResolvedValueOnce(customOut)
                .mockResolvedValueOnce("admin")
                .mockResolvedValueOnce("3000")
                .mockResolvedValueOnce("0.0.0.0");
            vi.mocked(confirm).mockResolvedValueOnce(false);

            await runInteractiveInit({});

            const expectedDefault = resolve(cwd, "loom.config.yaml");
            const customPathCall = vi.mocked(text).mock.calls[0][0] as {
                message: string;
                placeholder: string;
                initialValue: string;
            };
            expect(customPathCall.message).toBe("Config path");
            expect(customPathCall.placeholder).toBe(expectedDefault);
            expect(customPathCall.initialValue).toBe(expectedDefault);
        });

        it("outpath/admin-password select() prompts expose the expected options", async () => {
            const cwd = newRoot();
            const { runInteractiveInit } = await loadWizard(cwd);

            vi.mocked(select)
                .mockResolvedValueOnce("project")
                .mockResolvedValueOnce("env")
                .mockResolvedValueOnce("skip");
            vi.mocked(text)
                .mockResolvedValueOnce("admin")
                .mockResolvedValueOnce("3000")
                .mockResolvedValueOnce("0.0.0.0");
            vi.mocked(confirm).mockResolvedValueOnce(false);

            await runInteractiveInit({});

            const outPathSelectCall = vi.mocked(select).mock.calls[0][0] as {
                message: string;
                options: Array<{ value: string }>;
                initialValue: string;
            };
            expect(outPathSelectCall.message).toBe("Where should the config live?");
            expect(outPathSelectCall.options.map((o) => o.value)).toEqual(["project", "user", "custom"]);
            expect(outPathSelectCall.initialValue).toBe("project");

            const pwModeSelectCall = vi.mocked(select).mock.calls[1][0] as {
                message: string;
                options: Array<{ value: string }>;
            };
            expect(pwModeSelectCall.message).toBe("Admin password handling");
            expect(pwModeSelectCall.options.map((o) => o.value)).toEqual(["env", "inline"]);
        });
    });
});
