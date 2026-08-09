import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    userCwd,
    xdgConfigHome,
    locateConfigFile,
    interpolateEnv,
    parseConfigFile,
    applyConfigEnv,
    preflightFromConfig,
} from "@/lib/preflight";

// ---- Shared per-test sandbox --------------------------------------------
//
// Every test gets a pristine cwd + XDG_CONFIG_HOME temp directory pair and
// a full process.env snapshot/restore so tests can freely mutate env vars
// and the filesystem search path without leaking into other tests or into
// the real home directory (whose contents we don't control).

let envSnapshot: NodeJS.ProcessEnv;
let cwdDir: string;
let xdgDir: string;

beforeEach(() => {
    envSnapshot = { ...process.env };
    cwdDir = mkdtempSync(join(tmpdir(), "loom-preflight-cwd-"));
    xdgDir = mkdtempSync(join(tmpdir(), "loom-preflight-xdg-"));
    process.env.LOOM_USER_CWD = cwdDir;
    process.env.XDG_CONFIG_HOME = xdgDir;
    delete process.env.LOOM_CONFIG_PATH;
    // Both interpolateEnv (unset-var warning) and preflightFromConfig
    // (parse-failure error) log to the console by design. Silence them by
    // default so test output stays clean; the dedicated tests below assert
    // against these same mocks.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
        if (!(key in envSnapshot)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
        process.env[key] = value;
    }
    rmSync(cwdDir, { recursive: true, force: true });
    rmSync(xdgDir, { recursive: true, force: true });
});

describe("userCwd", () => {
    it("returns LOOM_USER_CWD when set", () => {
        expect(userCwd()).toBe(cwdDir);
    });

    it("returns a custom LOOM_USER_CWD value verbatim", () => {
        process.env.LOOM_USER_CWD = "/some/custom/dir";
        expect(userCwd()).toBe("/some/custom/dir");
    });

    it("falls back to process.cwd() when unset", () => {
        delete process.env.LOOM_USER_CWD;
        expect(userCwd()).toBe(process.cwd());
    });

    it("falls back to process.cwd() when set to an empty string", () => {
        process.env.LOOM_USER_CWD = "";
        expect(userCwd()).toBe(process.cwd());
    });
});

describe("xdgConfigHome", () => {
    it("returns XDG_CONFIG_HOME when set", () => {
        expect(xdgConfigHome()).toBe(xdgDir);
    });

    it("falls back to homedir()/.config when unset", () => {
        delete process.env.XDG_CONFIG_HOME;
        expect(xdgConfigHome()).toBe(resolve(homedir(), ".config"));
    });

    it("falls back to homedir()/.config when set to an empty string", () => {
        process.env.XDG_CONFIG_HOME = "";
        expect(xdgConfigHome()).toBe(resolve(homedir(), ".config"));
    });
});

describe("locateConfigFile", () => {
    it("returns null when no config file exists anywhere in the search path", () => {
        expect(locateConfigFile()).toBeNull();
    });

    it("finds {cwd}/loom.config.yaml", () => {
        const p = join(cwdDir, "loom.config.yaml");
        writeFileSync(p, "master_key: x\n");
        expect(locateConfigFile()).toBe(p);
    });

    it("finds {cwd}/loom.config.yml when .yaml is absent", () => {
        const p = join(cwdDir, "loom.config.yml");
        writeFileSync(p, "master_key: x\n");
        expect(locateConfigFile()).toBe(p);
    });

    it("finds {cwd}/loom.config.json when neither yaml nor yml exist", () => {
        const p = join(cwdDir, "loom.config.json");
        writeFileSync(p, "{}");
        expect(locateConfigFile()).toBe(p);
    });

    it("prefers .yaml over .yml and .json when multiple top-level candidates exist", () => {
        writeFileSync(join(cwdDir, "loom.config.json"), "{}");
        writeFileSync(join(cwdDir, "loom.config.yml"), "master_key: x\n");
        const yamlPath = join(cwdDir, "loom.config.yaml");
        writeFileSync(yamlPath, "master_key: x\n");
        expect(locateConfigFile()).toBe(yamlPath);
    });

    it("prefers .yml over .json when .yaml is absent", () => {
        writeFileSync(join(cwdDir, "loom.config.json"), "{}");
        const ymlPath = join(cwdDir, "loom.config.yml");
        writeFileSync(ymlPath, "master_key: x\n");
        expect(locateConfigFile()).toBe(ymlPath);
    });

    it("falls back to {cwd}/.config/loom.yaml when no top-level file exists", () => {
        mkdirSync(join(cwdDir, ".config"), { recursive: true });
        const p = join(cwdDir, ".config", "loom.yaml");
        writeFileSync(p, "master_key: x\n");
        expect(locateConfigFile()).toBe(p);
    });

    it("applies the same yaml > yml > json ordering inside {cwd}/.config", () => {
        mkdirSync(join(cwdDir, ".config"), { recursive: true });
        writeFileSync(join(cwdDir, ".config", "loom.json"), "{}");
        const ymlPath = join(cwdDir, ".config", "loom.yml");
        writeFileSync(ymlPath, "master_key: x\n");
        expect(locateConfigFile()).toBe(ymlPath);
    });

    it("falls back to $XDG_CONFIG_HOME/loom.yaml when neither cwd tier has a match", () => {
        const p = join(xdgDir, "loom.yaml");
        writeFileSync(p, "master_key: x\n");
        expect(locateConfigFile()).toBe(p);
    });

    it("prefers {cwd}/loom.config.* over {cwd}/.config/* over $XDG_CONFIG_HOME/*", () => {
        writeFileSync(join(xdgDir, "loom.yaml"), "master_key: xdg\n");
        mkdirSync(join(cwdDir, ".config"), { recursive: true });
        writeFileSync(join(cwdDir, ".config", "loom.yaml"), "master_key: dotconfig\n");
        const topLevel = join(cwdDir, "loom.config.yaml");
        writeFileSync(topLevel, "master_key: toplevel\n");
        expect(locateConfigFile()).toBe(topLevel);
    });

    it("prefers {cwd}/.config/* over $XDG_CONFIG_HOME/* when no top-level file exists", () => {
        writeFileSync(join(xdgDir, "loom.yaml"), "master_key: xdg\n");
        mkdirSync(join(cwdDir, ".config"), { recursive: true });
        const dotConfigPath = join(cwdDir, ".config", "loom.yaml");
        writeFileSync(dotConfigPath, "master_key: dotconfig\n");
        expect(locateConfigFile()).toBe(dotConfigPath);
    });

    it("resolves LOOM_CONFIG_PATH (relative) against userCwd and takes priority over the search order", () => {
        writeFileSync(join(cwdDir, "loom.config.yaml"), "master_key: default\n");
        const customPath = join(cwdDir, "custom.yaml");
        writeFileSync(customPath, "master_key: custom\n");
        process.env.LOOM_CONFIG_PATH = "custom.yaml";
        expect(locateConfigFile()).toBe(resolve(cwdDir, "custom.yaml"));
    });

    it("accepts an absolute LOOM_CONFIG_PATH regardless of userCwd", () => {
        const otherDir = mkdtempSync(join(tmpdir(), "loom-preflight-abs-"));
        try {
            const absPath = join(otherDir, "abs.yaml");
            writeFileSync(absPath, "master_key: abs\n");
            process.env.LOOM_CONFIG_PATH = absPath;
            expect(locateConfigFile()).toBe(absPath);
        } finally {
            rmSync(otherDir, { recursive: true, force: true });
        }
    });

    it("returns null when LOOM_CONFIG_PATH points to a nonexistent file, even if default candidates exist", () => {
        writeFileSync(join(cwdDir, "loom.config.yaml"), "master_key: default\n");
        process.env.LOOM_CONFIG_PATH = "does-not-exist.yaml";
        expect(locateConfigFile()).toBeNull();
    });
});

describe("interpolateEnv", () => {
    it("returns non-string primitives unchanged", () => {
        expect(interpolateEnv(42)).toBe(42);
        expect(interpolateEnv(true)).toBe(true);
        expect(interpolateEnv(false)).toBe(false);
        expect(interpolateEnv(null)).toBeNull();
        expect(interpolateEnv(undefined)).toBeUndefined();
    });

    it("returns a string with no ${...} placeholder unchanged", () => {
        expect(interpolateEnv("plain string")).toBe("plain string");
    });

    it("substitutes a single set env var", () => {
        process.env.PF_TEST_SET_1 = "hello";
        expect(interpolateEnv("prefix-${PF_TEST_SET_1}-suffix")).toBe("prefix-hello-suffix");
    });

    it("substitutes multiple set env vars in one string", () => {
        process.env.PF_TEST_SET_2 = "foo";
        process.env.PF_TEST_SET_3 = "bar";
        expect(interpolateEnv("${PF_TEST_SET_2}/${PF_TEST_SET_3}")).toBe("foo/bar");
    });

    it("collapses the whole string to undefined when the referenced var is unset", () => {
        delete process.env.PF_TEST_UNSET_1;
        expect(interpolateEnv("value=${PF_TEST_UNSET_1}")).toBeUndefined();
    });

    it("treats an env var set to the empty string as unset too", () => {
        process.env.PF_TEST_EMPTY_1 = "";
        expect(interpolateEnv("${PF_TEST_EMPTY_1}")).toBeUndefined();
    });

    it("collapses to undefined even when only one of several placeholders is unset", () => {
        process.env.PF_TEST_SET_4 = "known";
        delete process.env.PF_TEST_UNSET_2;
        expect(interpolateEnv("${PF_TEST_SET_4}-${PF_TEST_UNSET_2}")).toBeUndefined();
    });

    it("warns exactly once per unset variable name (one-shot dedupe)", () => {
        delete process.env.PF_TEST_WARN_ONCE;
        interpolateEnv("${PF_TEST_WARN_ONCE}");
        interpolateEnv("${PF_TEST_WARN_ONCE}");
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("PF_TEST_WARN_ONCE");
    });

    it("keeps array length, replacing an unset-var entry with undefined (does not filter it out)", () => {
        process.env.PF_TEST_ARR_SET = "kept";
        delete process.env.PF_TEST_ARR_UNSET;
        const result = interpolateEnv(["a", "${PF_TEST_ARR_UNSET}", "${PF_TEST_ARR_SET}"]);
        expect(result).toEqual(["a", undefined, "kept"]);
        expect(result).toHaveLength(3);
    });

    it("drops the key entirely when an object property collapses to undefined", () => {
        process.env.PF_TEST_OBJ_SET = "kept";
        delete process.env.PF_TEST_OBJ_UNSET;
        const result = interpolateEnv({ a: "${PF_TEST_OBJ_SET}", b: "${PF_TEST_OBJ_UNSET}" });
        expect(result).toEqual({ a: "kept" });
        expect(Object.prototype.hasOwnProperty.call(result, "b")).toBe(false);
    });

    it("keeps a null property value (only undefined drops the key)", () => {
        const result = interpolateEnv({ a: null, b: 5, c: true });
        expect(result).toEqual({ a: null, b: 5, c: true });
    });

    it("recurses into nested objects and arrays together", () => {
        process.env.PF_TEST_NESTED_SET = "yes";
        delete process.env.PF_TEST_NESTED_UNSET;
        const result = interpolateEnv({
            list: ["${PF_TEST_NESTED_SET}", "${PF_TEST_NESTED_UNSET}"],
            nested: { keep: "y", drop: "${PF_TEST_NESTED_UNSET}" },
        });
        expect(result).toEqual({
            list: ["yes", undefined],
            nested: { keep: "y" },
        });
    });

    it("leaves an empty object/array unchanged", () => {
        expect(interpolateEnv({})).toEqual({});
        expect(interpolateEnv([])).toEqual([]);
    });
});

describe("parseConfigFile", () => {
    it("parses a YAML file", () => {
        const p = join(cwdDir, "test.yaml");
        writeFileSync(p, "master_key: secret\nserver:\n  port: 4000\n");
        const cfg = parseConfigFile(p);
        expect(cfg).toEqual({ master_key: "secret", server: { port: 4000 } });
    });

    it("parses a .yml file using the YAML parser", () => {
        const p = join(cwdDir, "test.yml");
        writeFileSync(p, "master_key: secret\n");
        expect(parseConfigFile(p)).toEqual({ master_key: "secret" });
    });

    it("parses a .json file using JSON.parse", () => {
        const p = join(cwdDir, "test.json");
        writeFileSync(p, JSON.stringify({ master_key: "secret", server: { port: 4000 } }));
        expect(parseConfigFile(p)).toEqual({ master_key: "secret", server: { port: 4000 } });
    });

    it("applies interpolateEnv to the parsed result, dropping unset placeholders", () => {
        process.env.PF_TEST_PARSE_SET = "resolved-value";
        delete process.env.PF_TEST_PARSE_UNSET;
        const p = join(cwdDir, "interp.yaml");
        writeFileSync(
            p,
            "master_key: ${PF_TEST_PARSE_SET}\nadmin:\n  username: admin\n  password: ${PF_TEST_PARSE_UNSET}\n",
        );
        const cfg = parseConfigFile(p);
        expect(cfg).toEqual({ master_key: "resolved-value", admin: { username: "admin" } });
    });

    it("returns {} for an empty YAML file", () => {
        const p = join(cwdDir, "empty.yaml");
        writeFileSync(p, "");
        expect(parseConfigFile(p)).toEqual({});
    });

    it("returns {} for a YAML file containing only comments", () => {
        const p = join(cwdDir, "comment-only.yaml");
        writeFileSync(p, "# nothing here\n");
        expect(parseConfigFile(p)).toEqual({});
    });

    it("throws when the YAML file is malformed", () => {
        const p = join(cwdDir, "bad.yaml");
        writeFileSync(p, "a: [1,2\nb: {");
        expect(() => parseConfigFile(p)).toThrow();
    });

    it("throws when the JSON file is malformed", () => {
        const p = join(cwdDir, "bad.json");
        writeFileSync(p, "{ not valid json");
        expect(() => parseConfigFile(p)).toThrow();
    });
});

describe("applyConfigEnv", () => {
    it("returns [] for a null cfg", () => {
        expect(applyConfigEnv(null)).toEqual([]);
    });

    it("returns [] for an undefined cfg", () => {
        expect(applyConfigEnv(undefined)).toEqual([]);
    });

    it("returns [] for a non-object cfg", () => {
         
        expect(applyConfigEnv("not-an-object" as any)).toEqual([]);
    });

    it("returns [] and sets nothing for an empty cfg object", () => {
        expect(applyConfigEnv({})).toEqual([]);
    });

    it("sets LOOM_MASTER_KEY from master_key when currently unset", () => {
        delete process.env.LOOM_MASTER_KEY;
        const applied = applyConfigEnv({ master_key: "new-secret" });
        expect(process.env.LOOM_MASTER_KEY).toBe("new-secret");
        expect(applied).toContain("LOOM_MASTER_KEY");
    });

    it("never overrides an already non-empty LOOM_MASTER_KEY", () => {
        process.env.LOOM_MASTER_KEY = "existing";
        const applied = applyConfigEnv({ master_key: "new-secret" });
        expect(process.env.LOOM_MASTER_KEY).toBe("existing");
        expect(applied).not.toContain("LOOM_MASTER_KEY");
    });

    it("DOES override a var that is currently set to an empty string", () => {
        process.env.LOOM_MASTER_KEY = "";
        const applied = applyConfigEnv({ master_key: "new-secret" });
        expect(process.env.LOOM_MASTER_KEY).toBe("new-secret");
        expect(applied).toContain("LOOM_MASTER_KEY");
    });

    it("maps database.path to LOOM_DB_PATH", () => {
        delete process.env.LOOM_DB_PATH;
        const applied = applyConfigEnv({ database: { path: "./data/loom.db" } });
        expect(process.env.LOOM_DB_PATH).toBe("./data/loom.db");
        expect(applied).toContain("LOOM_DB_PATH");
    });

    it("does not set an env var when the config value is an empty string", () => {
        delete process.env.LOOM_DB_PATH;
        const applied = applyConfigEnv({ database: { path: "" } });
        expect(process.env.LOOM_DB_PATH).toBeUndefined();
        expect(applied).not.toContain("LOOM_DB_PATH");
    });

    it("maps admin.username and admin.password", () => {
        delete process.env.LOOM_ADMIN_USERNAME;
        delete process.env.LOOM_ADMIN_PASSWORD;
        const applied = applyConfigEnv({ admin: { username: "root", password: "hunter2" } });
        expect(process.env.LOOM_ADMIN_USERNAME).toBe("root");
        expect(process.env.LOOM_ADMIN_PASSWORD).toBe("hunter2");
        expect(applied).toEqual(expect.arrayContaining(["LOOM_ADMIN_USERNAME", "LOOM_ADMIN_PASSWORD"]));
    });

    it("maps session.ttl_days to LOOM_SESSION_TTL_DAYS, stringifying the number", () => {
        delete process.env.LOOM_SESSION_TTL_DAYS;
        const applied = applyConfigEnv({ session: { ttl_days: 30 } });
        expect(process.env.LOOM_SESSION_TTL_DAYS).toBe("30");
        expect(applied).toContain("LOOM_SESSION_TTL_DAYS");
    });

    it("maps cache.models_ttl_seconds to LOOM_MODELS_CACHE_TTL, including a value of 0", () => {
        delete process.env.LOOM_MODELS_CACHE_TTL;
        const applied = applyConfigEnv({ cache: { models_ttl_seconds: 0 } });
        expect(process.env.LOOM_MODELS_CACHE_TTL).toBe("0");
        expect(applied).toContain("LOOM_MODELS_CACHE_TTL");
    });

    it("maps server.port and server.hostname", () => {
        delete process.env.LOOM_SERVER_PORT;
        delete process.env.LOOM_SERVER_HOSTNAME;
        const applied = applyConfigEnv({ server: { port: 4000, hostname: "0.0.0.0" } });
        expect(process.env.LOOM_SERVER_PORT).toBe("4000");
        expect(process.env.LOOM_SERVER_HOSTNAME).toBe("0.0.0.0");
        expect(applied).toEqual(expect.arrayContaining(["LOOM_SERVER_PORT", "LOOM_SERVER_HOSTNAME"]));
    });

    it("maps server.trust_proxy=true to LOOM_TRUST_PROXY='1'", () => {
        delete process.env.LOOM_TRUST_PROXY;
        const applied = applyConfigEnv({ server: { trust_proxy: true } });
        expect(process.env.LOOM_TRUST_PROXY).toBe("1");
        expect(applied).toContain("LOOM_TRUST_PROXY");
    });

    it("does not set LOOM_TRUST_PROXY when trust_proxy is false", () => {
        delete process.env.LOOM_TRUST_PROXY;
        const applied = applyConfigEnv({ server: { trust_proxy: false } });
        expect(process.env.LOOM_TRUST_PROXY).toBeUndefined();
        expect(applied).not.toContain("LOOM_TRUST_PROXY");
    });

    it("does not set LOOM_TRUST_PROXY when server is omitted entirely", () => {
        delete process.env.LOOM_TRUST_PROXY;
        const applied = applyConfigEnv({});
        expect(process.env.LOOM_TRUST_PROXY).toBeUndefined();
        expect(applied).toEqual([]);
    });

    it("ignores fields that are simply absent from the config", () => {
        delete process.env.LOOM_ADMIN_USERNAME;
        const applied = applyConfigEnv({ admin: { password: "only-password" } });
        expect(process.env.LOOM_ADMIN_USERNAME).toBeUndefined();
        expect(applied).not.toContain("LOOM_ADMIN_USERNAME");
    });
});

describe("preflightFromConfig", () => {
    it("returns null path/cfg and an empty applied list when nothing is found", () => {
        const result = preflightFromConfig();
        expect(result).toEqual({ path: null, cfg: null, applied: [] });
    });

    it("locates, parses and applies env vars from a discovered config file", () => {
        delete process.env.LOOM_MASTER_KEY;
        delete process.env.LOOM_SERVER_PORT;
        const p = join(cwdDir, "loom.config.yaml");
        writeFileSync(p, "master_key: found-secret\nserver:\n  port: 5050\n");

        const result = preflightFromConfig();

        expect(result.path).toBe(p);
        expect(result.cfg).toEqual({ master_key: "found-secret", server: { port: 5050 } });
        expect(result.applied).toEqual(expect.arrayContaining(["LOOM_MASTER_KEY", "LOOM_SERVER_PORT"]));
        expect(process.env.LOOM_MASTER_KEY).toBe("found-secret");
        expect(process.env.LOOM_SERVER_PORT).toBe("5050");
    });

    it("returns cfg: null and logs an error when the discovered file fails to parse", () => {
        const p = join(cwdDir, "loom.config.json");
        writeFileSync(p, "{ not valid json");

        const result = preflightFromConfig();

        expect(result.path).toBe(p);
        expect(result.cfg).toBeNull();
        expect(result.applied).toEqual([]);
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.error).mock.calls[0][0]).toContain(p);
    });

    it("honours an explicit LOOM_CONFIG_PATH over the default search order", () => {
        delete process.env.LOOM_MASTER_KEY;
        writeFileSync(join(cwdDir, "loom.config.yaml"), "master_key: default-file\n");
        const customPath = join(cwdDir, "custom.yaml");
        writeFileSync(customPath, "master_key: custom-file\n");
        process.env.LOOM_CONFIG_PATH = "custom.yaml";

        const result = preflightFromConfig();

        expect(result.path).toBe(resolve(cwdDir, "custom.yaml"));
        expect(result.cfg).toEqual({ master_key: "custom-file" });
        expect(process.env.LOOM_MASTER_KEY).toBe("custom-file");
    });
});
