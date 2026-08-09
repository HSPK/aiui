import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemeDescriptor } from "@/lib/themes/types";

function fakeTheme(overrides: Partial<ThemeDescriptor> & Pick<ThemeDescriptor, "id">): ThemeDescriptor {
    return {
        label: overrides.id,
        description: "test theme",
        flair: "minimal",
        tokens: { light: {}, dark: {} },
        preview: { swatches: ["#fff", "#000", "#eee", "#999"] },
        ...overrides,
    };
}

describe("lib/themes/registry", () => {
    // The registry is a bare module-level singleton Map with no exposed
    // reset function, so every test gets a fully fresh module instance via
    // resetModules() + a dynamic re-import. This keeps tests hermetic and
    // order-independent without touching any file outside tests/dom/api.
    let registryMod: typeof import("@/lib/themes/registry");

    beforeEach(async () => {
        vi.resetModules();
        registryMod = await import("@/lib/themes/registry");
    });

    it("DEFAULT_THEME_ID is 'default'", () => {
        expect(registryMod.DEFAULT_THEME_ID).toBe("default");
    });

    it("getTheme returns undefined for an id that was never registered", () => {
        expect(registryMod.getTheme("nope")).toBeUndefined();
    });

    it("registerTheme + getTheme round-trips a descriptor", () => {
        const theme = fakeTheme({ id: "alpha" });
        registryMod.registerTheme(theme);
        expect(registryMod.getTheme("alpha")).toEqual(theme);
    });

    it("getAllThemes preserves first-registration insertion order", () => {
        registryMod.registerTheme(fakeTheme({ id: "first" }));
        registryMod.registerTheme(fakeTheme({ id: "second" }));
        registryMod.registerTheme(fakeTheme({ id: "third" }));

        const ids = registryMod.getAllThemes().map((t) => t.id);
        expect(ids).toEqual(["first", "second", "third"]);
    });

    it("re-registering an existing id overwrites the descriptor but does NOT move its position", () => {
        registryMod.registerTheme(fakeTheme({ id: "first", label: "First v1" }));
        registryMod.registerTheme(fakeTheme({ id: "second", label: "Second" }));
        registryMod.registerTheme(fakeTheme({ id: "first", label: "First v2" }));

        const all = registryMod.getAllThemes();
        expect(all.map((t) => t.id)).toEqual(["first", "second"]);
        expect(registryMod.getTheme("first")?.label).toBe("First v2");
    });

    describe("resolveTheme", () => {
        beforeEach(() => {
            registryMod.registerTheme(fakeTheme({ id: "default", label: "Default" }));
            registryMod.registerTheme(fakeTheme({ id: "custom", label: "Custom" }));
        });

        it("resolves a registered id", () => {
            expect(registryMod.resolveTheme("custom")?.id).toBe("custom");
        });

        it("falls back to the default theme for an unregistered id", () => {
            expect(registryMod.resolveTheme("does-not-exist")?.id).toBe("default");
        });

        it("falls back to the default theme for undefined", () => {
            expect(registryMod.resolveTheme(undefined)?.id).toBe("default");
        });

        it("falls back to the default theme for null", () => {
            expect(registryMod.resolveTheme(null)?.id).toBe("default");
        });

        it("falls back to the default theme for an empty string", () => {
            expect(registryMod.resolveTheme("")?.id).toBe("default");
        });
    });

    it("resolveTheme returns undefined if called before a default theme is ever registered (documents the non-null-assertion's runtime silence)", () => {
        // No `registerTheme` call at all in this test — the registry is
        // empty. `resolveTheme`'s `registry.get(DEFAULT_THEME_ID)!` uses a
        // compile-time-only `!` assertion, so at runtime this legitimately
        // returns `undefined` rather than throwing. In the real app this
        // path is unreachable because lib/themes/index.ts always imports
        // ./register (which registers "default") before any consumer can
        // call resolveTheme.
        expect(registryMod.resolveTheme("anything")).toBeUndefined();
    });

    describe("compileThemeStylesheet", () => {
        it("emits nothing for a theme with entirely empty light/dark token maps", () => {
            registryMod.registerTheme(fakeTheme({ id: "empty", tokens: { light: {}, dark: {} } }));
            expect(registryMod.compileThemeStylesheet()).toBe("");
        });

        it("emits only a light block when dark tokens are empty", () => {
            registryMod.registerTheme(
                fakeTheme({ id: "light-only", tokens: { light: { background: "white" }, dark: {} } }),
            );
            const css = registryMod.compileThemeStylesheet();
            expect(css).toBe(':root[data-theme="light-only"]{--background:white;}');
        });

        it("emits only a dark block when light tokens are empty", () => {
            registryMod.registerTheme(
                fakeTheme({ id: "dark-only", tokens: { light: {}, dark: { background: "black" } } }),
            );
            const css = registryMod.compileThemeStylesheet();
            expect(css).toBe(':root[data-theme="dark-only"].dark{--background:black;}');
        });

        it("emits both blocks, newline-joined, for a theme with both light and dark tokens", () => {
            registryMod.registerTheme(
                fakeTheme({
                    id: "both",
                    tokens: {
                        light: { background: "white", foreground: "black" },
                        dark: { background: "black" },
                    },
                }),
            );
            const css = registryMod.compileThemeStylesheet();
            expect(css).toBe(
                ':root[data-theme="both"]{--background:white;--foreground:black;}\n:root[data-theme="both"].dark{--background:black;}',
            );
        });

        it("joins multiple registered themes' blocks with newlines, in insertion order", () => {
            registryMod.registerTheme(fakeTheme({ id: "one", tokens: { light: { a: "1" }, dark: {} } }));
            registryMod.registerTheme(fakeTheme({ id: "two", tokens: { light: { b: "2" }, dark: {} } }));
            const css = registryMod.compileThemeStylesheet();
            expect(css).toBe(':root[data-theme="one"]{--a:1;}\n:root[data-theme="two"]{--b:2;}');
        });
    });

    describe("the real preset registrations (via lib/themes/register.ts)", () => {
        it("registers default, paper, terminal and aurora in that documented order", async () => {
            await import("@/lib/themes/register");
            const ids = registryMod.getAllThemes().map((t) => t.id);
            expect(ids).toEqual(["default", "paper", "terminal", "aurora"]);
        });

        it("the default theme has empty tokens (inherits app/globals.css) and a minimal flair", async () => {
            await import("@/lib/themes/register");
            const def = registryMod.getTheme("default");
            expect(def).toBeDefined();
            expect(def?.tokens).toEqual({ light: {}, dark: {} });
            expect(def?.flair).toBe("minimal");
        });

        it("terminal forces a dark scheme", async () => {
            await import("@/lib/themes/register");
            expect(registryMod.getTheme("terminal")?.forceScheme).toBe("dark");
        });

        it("resolveTheme(undefined) resolves to the real default preset once presets are loaded", async () => {
            await import("@/lib/themes/register");
            expect(registryMod.resolveTheme(undefined)?.id).toBe("default");
            expect(registryMod.resolveTheme("terminal")?.id).toBe("terminal");
            expect(registryMod.resolveTheme("totally-unknown")?.id).toBe("default");
        });
    });
});

describe("lib/themes/storage", () => {
    let storageMod: typeof import("@/lib/themes/storage");

    beforeEach(async () => {
        localStorage.clear();
        vi.resetModules();
        storageMod = await import("@/lib/themes/storage");
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("THEME_STORAGE_KEY is 'loom-theme'", () => {
        expect(storageMod.THEME_STORAGE_KEY).toBe("loom-theme");
    });

    it("readStoredTheme returns null when nothing has been stored", () => {
        expect(storageMod.readStoredTheme()).toBeNull();
    });

    it("writeStoredTheme / readStoredTheme round-trip a valid theme", () => {
        storageMod.writeStoredTheme({ id: "terminal", scheme: "dark" });
        expect(storageMod.readStoredTheme()).toEqual({ id: "terminal", scheme: "dark" });

        const raw = localStorage.getItem("loom-theme");
        expect(raw).toBe(JSON.stringify({ id: "terminal", scheme: "dark" }));
    });

    it("readStoredTheme returns null for malformed JSON", () => {
        localStorage.setItem("loom-theme", "{not json");
        expect(storageMod.readStoredTheme()).toBeNull();
    });

    it("readStoredTheme returns null when id is missing or not a string", () => {
        localStorage.setItem("loom-theme", JSON.stringify({ scheme: "dark" }));
        expect(storageMod.readStoredTheme()).toBeNull();

        localStorage.setItem("loom-theme", JSON.stringify({ id: 42, scheme: "dark" }));
        expect(storageMod.readStoredTheme()).toBeNull();
    });

    it("readStoredTheme returns null when scheme is not one of light/dark/system", () => {
        localStorage.setItem("loom-theme", JSON.stringify({ id: "default", scheme: "purple" }));
        expect(storageMod.readStoredTheme()).toBeNull();
    });

    it.each(["light", "dark", "system"] as const)("readStoredTheme accepts scheme=%s", (scheme) => {
        localStorage.setItem("loom-theme", JSON.stringify({ id: "default", scheme }));
        expect(storageMod.readStoredTheme()).toEqual({ id: "default", scheme });
    });

    it("readStoredTheme returns null (SSR-safe) when window is undefined", () => {
        vi.stubGlobal("window", undefined);
        expect(storageMod.readStoredTheme()).toBeNull();
    });

    it("writeStoredTheme is a no-op (SSR-safe) when window is undefined", () => {
        vi.stubGlobal("window", undefined);
        expect(() => storageMod.writeStoredTheme({ id: "default", scheme: "light" })).not.toThrow();
    });

    it("writeStoredTheme silently swallows a quota-exceeded (or any) storage error", () => {
        const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("QuotaExceededError");
        });
        expect(() => storageMod.writeStoredTheme({ id: "default", scheme: "light" })).not.toThrow();
        setItemSpy.mockRestore();
    });

    describe("THEME_BOOTSTRAP_SCRIPT", () => {
        beforeEach(() => {
            document.documentElement.removeAttribute("data-theme");
            document.documentElement.classList.remove("dark");
        });

        function runBootstrapScript() {
             
            eval(storageMod.THEME_BOOTSTRAP_SCRIPT);
        }

        it("embeds the storage key as a JSON string literal", () => {
            expect(storageMod.THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify("loom-theme"));
        });

        it("is a no-op when nothing is stored", () => {
            runBootstrapScript();
            expect(document.documentElement.dataset.theme).toBeUndefined();
            expect(document.documentElement.classList.contains("dark")).toBe(false);
        });

        it("sets data-theme and adds .dark for an explicit dark scheme", () => {
            localStorage.setItem("loom-theme", JSON.stringify({ id: "terminal", scheme: "dark" }));
            runBootstrapScript();
            expect(document.documentElement.dataset.theme).toBe("terminal");
            expect(document.documentElement.classList.contains("dark")).toBe(true);
        });

        it("sets data-theme and removes .dark for an explicit light scheme", () => {
            document.documentElement.classList.add("dark");
            localStorage.setItem("loom-theme", JSON.stringify({ id: "paper", scheme: "light" }));
            runBootstrapScript();
            expect(document.documentElement.dataset.theme).toBe("paper");
            expect(document.documentElement.classList.contains("dark")).toBe(false);
        });

        it("resolves scheme='system' via matchMedia (dark)", () => {
            vi.spyOn(window, "matchMedia").mockReturnValue({
                matches: true,
                media: "(prefers-color-scheme: dark)",
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false,
            } as unknown as MediaQueryList);
            localStorage.setItem("loom-theme", JSON.stringify({ id: "default", scheme: "system" }));
            runBootstrapScript();
            expect(document.documentElement.classList.contains("dark")).toBe(true);
        });

        it("resolves scheme='system' via matchMedia (light)", () => {
            vi.spyOn(window, "matchMedia").mockReturnValue({
                matches: false,
                media: "(prefers-color-scheme: dark)",
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false,
            } as unknown as MediaQueryList);
            localStorage.setItem("loom-theme", JSON.stringify({ id: "default", scheme: "system" }));
            runBootstrapScript();
            expect(document.documentElement.classList.contains("dark")).toBe(false);
        });

        it("silently no-ops on malformed stored JSON (try/catch)", () => {
            localStorage.setItem("loom-theme", "{not json");
            expect(runBootstrapScript).not.toThrow();
            expect(document.documentElement.dataset.theme).toBeUndefined();
        });

        it("sets only data-theme, leaving .dark untouched, when the stored payload has no scheme field", () => {
            localStorage.setItem("loom-theme", JSON.stringify({ id: "aurora" }));
            runBootstrapScript();
            expect(document.documentElement.dataset.theme).toBe("aurora");
            expect(document.documentElement.classList.contains("dark")).toBe(false);
        });
    });
});

describe("lib/themes/index (public barrel)", () => {
    it("importing the barrel alone populates the registry via its ./register side-effect import", async () => {
        vi.resetModules();
        const barrel = await import("@/lib/themes/index");
        // No explicit "./register" import needed by the consumer — the
        // barrel guarantees presets are registered just by being imported.
        expect(barrel.getTheme("default")).toBeDefined();
        expect(barrel.getTheme("terminal")).toBeDefined();
        expect(barrel.getAllThemes().map((t) => t.id)).toEqual(["default", "paper", "terminal", "aurora"]);
        expect(barrel.resolveTheme(undefined)?.id).toBe("default");
        expect(barrel.DEFAULT_THEME_ID).toBe("default");
    });

    it("re-exports the storage helpers by identity", async () => {
        vi.resetModules();
        const barrel = await import("@/lib/themes/index");
        const storageMod = await import("@/lib/themes/storage");
        expect(barrel.THEME_STORAGE_KEY).toBe(storageMod.THEME_STORAGE_KEY);
        expect(barrel.readStoredTheme).toBe(storageMod.readStoredTheme);
        expect(barrel.writeStoredTheme).toBe(storageMod.writeStoredTheme);
        expect(barrel.THEME_BOOTSTRAP_SCRIPT).toBe(storageMod.THEME_BOOTSTRAP_SCRIPT);
    });

    it("does not export anything unexpected", async () => {
        vi.resetModules();
        const barrel = await import("@/lib/themes/index");
        expect(Object.keys(barrel).sort()).toEqual(
            [
                "DEFAULT_THEME_ID",
                "compileThemeStylesheet",
                "getAllThemes",
                "getTheme",
                "resolveTheme",
                "THEME_BOOTSTRAP_SCRIPT",
                "THEME_STORAGE_KEY",
                "readStoredTheme",
                "writeStoredTheme",
            ].sort(),
        );
    });
});
