import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { cleanupTempDir, makeTempDir } from "./test-helpers";

// Vitest can't spy directly on a live ESM namespace ("Module namespace is
// not configurable in ESM"), so the one test that needs a failing
// `symlinkSync` wraps it via `vi.mock` with a real-by-default passthrough
// and overrides it with `mockImplementationOnce` only for that assertion.
vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return { ...actual, symlinkSync: vi.fn(actual.symlinkSync) };
});

// ensureExternalAliases() computes MANIFEST/MODULES_DIR from PACKAGE_ROOT
// (imported from ./paths) ONCE at module-eval time. To point it at a
// throwaway directory tree per test we set LOOM_PACKAGE_ROOT and do a
// fresh dynamic import via vi.resetModules().

const ORIGINAL_ROOT = process.env.LOOM_PACKAGE_ROOT;

let dirs: string[] = [];

function newRoot(): string {
    const d = makeTempDir();
    dirs.push(d);
    return d;
}

async function load(root: string) {
    process.env.LOOM_PACKAGE_ROOT = root;
    vi.resetModules();
    return import("@/lib/cli/external-aliases");
}

/** Create a resolvable fake package under `<root>/node_modules/<name>` —
 *  createRequire(root/package.json).resolve(`${name}/package.json`) finds
 *  this file directly (no "exports" map, no "main" needed: the request
 *  path is a literal file inside the package directory). */
function makeFakePackage(root: string, name: string): string {
    const dir = resolve(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    return dir;
}

function writeManifest(root: string, aliases: unknown): void {
    mkdirSync(resolve(root, ".next"), { recursive: true });
    writeFileSync(
        resolve(root, ".next", "external-aliases.json"),
        typeof aliases === "string" ? aliases : JSON.stringify(aliases),
    );
}

describe("lib/cli/external-aliases: ensureExternalAliases", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        // Every test creates its own root; keep a stub package.json there so
        // createRequire has something plausible to resolve against.
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        for (const d of dirs) cleanupTempDir(d);
        dirs = [];
        if (ORIGINAL_ROOT === undefined) delete process.env.LOOM_PACKAGE_ROOT;
        else process.env.LOOM_PACKAGE_ROOT = ORIGINAL_ROOT;
        vi.resetModules();
    });

    it("no manifest file present -> no-op, no .next/node_modules created", async () => {
        const root = newRoot();
        const { ensureExternalAliases } = await load(root);

        expect(() => ensureExternalAliases()).not.toThrow();

        expect(existsSync(resolve(root, ".next", "node_modules"))).toBe(false);
        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("malformed manifest JSON -> warns and returns without creating MODULES_DIR", async () => {
        const root = newRoot();
        writeManifest(root, "{ not valid json");
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [msg] = warnSpy.mock.calls[0] as unknown[];
        expect(String(msg)).toContain("failed to parse");
        expect(existsSync(resolve(root, ".next", "node_modules"))).toBe(false);
    });

    it("empty object manifest -> no-op (no MODULES_DIR, no warnings)", async () => {
        const root = newRoot();
        writeManifest(root, {});
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        expect(existsSync(resolve(root, ".next", "node_modules"))).toBe(false);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    it("manifest that parses to a non-object scalar (e.g. `true`) -> no-op", async () => {
        const root = newRoot();
        writeManifest(root, "true");
        const { ensureExternalAliases } = await load(root);

        expect(() => ensureExternalAliases()).not.toThrow();
        expect(existsSync(resolve(root, ".next", "node_modules"))).toBe(false);
    });

    it("manifest that parses to `null` -> no-op (the `!aliases` guard)", async () => {
        const root = newRoot();
        writeManifest(root, "null");
        const { ensureExternalAliases } = await load(root);

        expect(() => ensureExternalAliases()).not.toThrow();
        expect(existsSync(resolve(root, ".next", "node_modules"))).toBe(false);
    });

    it("valid manifest with one resolvable package -> creates a symlink alias (singular log)", async () => {
        const root = newRoot();
        const pkgDir = makeFakePackage(root, "fake-pkg");
        writeManifest(root, { "fake-pkg-abc123": "fake-pkg" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        const linkPath = resolve(root, ".next", "node_modules", "fake-pkg-abc123");
        const stat = lstatSync(linkPath);
        expect(stat.isSymbolicLink()).toBe(true);
        const target = resolve(resolve(root, ".next", "node_modules"), readlinkSync(linkPath));
        expect(target).toBe(pkgDir);

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("linked 1 external package alias"));
        // Singular form: no trailing "es".
        expect(logSpy.mock.calls[0][0]).not.toContain("aliases");
    });

    it("valid manifest with two resolvable packages -> plural log message", async () => {
        const root = newRoot();
        makeFakePackage(root, "fake-pkg-a");
        makeFakePackage(root, "fake-pkg-b");
        writeManifest(root, { "hash-a": "fake-pkg-a", "hash-b": "fake-pkg-b" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("linked 2 external package aliases"));
    });

    it("existing valid symlink is left untouched (resolution never re-attempted)", async () => {
        const root = newRoot();
        // Point the pre-existing symlink at a real directory that has
        // nothing to do with the (bogus/unresolvable) manifest package
        // name — if the code ever re-resolved, it would warn and this
        // real directory would remain the wrong shape. Proves `continue`
        // short-circuits before rmSync/resolve even run.
        const modulesDir = resolve(root, ".next", "node_modules");
        mkdirSync(modulesDir, { recursive: true });
        const preexistingTarget = resolve(root, "some-real-dir");
        mkdirSync(preexistingTarget, { recursive: true });
        const linkPath = resolve(modulesDir, "my-alias");
        symlinkSync(relative(modulesDir, preexistingTarget), linkPath, "junction");
        const originalReadlink = readlinkSync(linkPath);

        writeManifest(root, { "my-alias": "totally-bogus-package-does-not-exist" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        expect(readlinkSync(linkPath)).toBe(originalReadlink);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    it("broken/stale symlink (target missing) is recreated", async () => {
        const root = newRoot();
        const pkgDir = makeFakePackage(root, "fake-pkg");
        const modulesDir = resolve(root, ".next", "node_modules");
        mkdirSync(modulesDir, { recursive: true });
        const linkPath = resolve(modulesDir, "stale-alias");
        // Dangling symlink: target does not exist.
        symlinkSync("../../does-not-exist", linkPath, "junction");

        writeManifest(root, { "stale-alias": "fake-pkg" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        const stat = lstatSync(linkPath);
        expect(stat.isSymbolicLink()).toBe(true);
        const target = resolve(modulesDir, readlinkSync(linkPath));
        expect(target).toBe(pkgDir);
        expect(existsSync(target)).toBe(true);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("linked 1 external package alias"));
    });

    it("existing non-symlink entry at the link path is removed and replaced", async () => {
        const root = newRoot();
        const pkgDir = makeFakePackage(root, "fake-pkg");
        const modulesDir = resolve(root, ".next", "node_modules");
        const linkPath = resolve(modulesDir, "was-a-dir");
        mkdirSync(linkPath, { recursive: true });
        writeFileSync(resolve(linkPath, "marker.txt"), "x");

        writeManifest(root, { "was-a-dir": "fake-pkg" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        const stat = lstatSync(linkPath);
        expect(stat.isSymbolicLink()).toBe(true);
        expect(resolve(modulesDir, readlinkSync(linkPath))).toBe(pkgDir);
    });

    it("unresolvable package -> skipped with a warning, no symlink created", async () => {
        const root = newRoot();
        writeManifest(root, { "bad-alias": "no-such-package-xyz" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        const linkPath = resolve(root, ".next", "node_modules", "bad-alias");
        expect(existsSync(linkPath)).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [msg] = warnSpy.mock.calls[0] as unknown[];
        expect(String(msg)).toContain("couldn't resolve");
        expect(String(msg)).toContain("no-such-package-xyz");
        // Nothing succeeded, so no "linked N" summary line.
        expect(logSpy).not.toHaveBeenCalled();
    });

    it("mixed manifest: one resolvable + one unresolvable -> partial success", async () => {
        const root = newRoot();
        makeFakePackage(root, "good-pkg");
        writeManifest(root, { "good-alias": "good-pkg", "bad-alias": "nope-xyz" });
        const { ensureExternalAliases } = await load(root);

        ensureExternalAliases();

        expect(existsSync(resolve(root, ".next", "node_modules", "good-alias"))).toBe(true);
        expect(existsSync(resolve(root, ".next", "node_modules", "bad-alias"))).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("linked 1 external package alias"));
    });

    it("symlink creation failure is caught and warned, loop continues", async () => {
        const root = newRoot();
        makeFakePackage(root, "fake-pkg");
        const modulesDir = resolve(root, ".next", "node_modules");
        mkdirSync(modulesDir, { recursive: true });
        writeManifest(root, { "fake-alias": "fake-pkg" });
        const { ensureExternalAliases } = await load(root);

        vi.mocked(symlinkSync).mockImplementationOnce(() => {
            throw new Error("EPERM: simulated");
        });

        expect(() => ensureExternalAliases()).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("failed to symlink"));
    });
});
