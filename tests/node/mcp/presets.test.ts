import { describe, expect, it } from "vitest";
import { MCP_PRESETS } from "@/lib/server/mcp/presets";
import {
    mcpHttpConfigSchema,
    mcpPresetCategorySchema,
    mcpPresetSchema,
    mcpStdioConfigSchema,
} from "@/lib/schemas/mcp";

/** Resolve a slot's dot-path (e.g. `env.GITHUB_TOKEN`, `args[2]`) against a
 *  preset's config object. Returns `{ found: boolean }` — the presets use
 *  placeholder strings for anything a slot points at, so we only assert
 *  reachability here, not any particular value. */
function resolveSlotPath(config: Record<string, unknown>, path: string): { found: boolean } {
    const segments = path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);
    let cur: unknown = config;
    for (const seg of segments) {
        if (cur === null || cur === undefined || typeof cur !== "object") return { found: false };
        const key = /^\d+$/.test(seg) ? Number(seg) : seg;
        if (Array.isArray(cur)) {
            if (typeof key !== "number" || key < 0 || key >= cur.length) return { found: false };
            cur = cur[key];
        } else {
            const rec = cur as Record<string, unknown>;
            if (!(String(key) in rec)) return { found: false };
            cur = rec[String(key)];
        }
    }
    return { found: true };
}

describe("MCP_PRESETS catalogue", () => {
    it("is a non-empty array", () => {
        expect(Array.isArray(MCP_PRESETS)).toBe(true);
        expect(MCP_PRESETS.length).toBeGreaterThan(0);
    });

    it("every preset parses against mcpPresetSchema", () => {
        for (const preset of MCP_PRESETS) {
            const result = mcpPresetSchema.safeParse(preset);
            expect(result.success, `preset "${preset.id}" failed: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(true);
        }
    });

    it("every preset's config matches its own transport-specific schema", () => {
        for (const preset of MCP_PRESETS) {
            const parser = preset.transport === "stdio" ? mcpStdioConfigSchema : mcpHttpConfigSchema;
            const result = parser.safeParse(preset.config);
            expect(result.success, `preset "${preset.id}" config failed: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(true);
        }
    });

    it("has no duplicate ids", () => {
        const ids = MCP_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("has no duplicate names", () => {
        const names = MCP_PRESETS.map((p) => p.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("every category is a member of the preset category enum", () => {
        for (const preset of MCP_PRESETS) {
            expect(mcpPresetCategorySchema.safeParse(preset.category).success).toBe(true);
        }
    });

    it("every non-empty homepage is a well-formed URL", () => {
        for (const preset of MCP_PRESETS) {
            if (!preset.homepage) continue;
            expect(() => new URL(preset.homepage as string)).not.toThrow();
        }
    });

    it("every slot path resolves inside its own preset's config", () => {
        for (const preset of MCP_PRESETS) {
            for (const slot of preset.slots) {
                const { found } = resolveSlotPath(preset.config as Record<string, unknown>, slot.path);
                expect(found, `preset "${preset.id}" slot "${slot.path}" does not resolve`).toBe(true);
            }
        }
    });

    it("every slot has a non-empty label and a valid kind", () => {
        for (const preset of MCP_PRESETS) {
            for (const slot of preset.slots) {
                expect(slot.label.length).toBeGreaterThan(0);
                expect(["secret", "path", "text"]).toContain(slot.kind);
            }
        }
    });

    it("stdio presets declare a non-empty command", () => {
        for (const preset of MCP_PRESETS) {
            if (preset.transport !== "stdio") continue;
            const cfg = preset.config as { command?: string };
            expect(typeof cfg.command).toBe("string");
            expect((cfg.command as string).length).toBeGreaterThan(0);
        }
    });

    it("http presets declare a valid url", () => {
        for (const preset of MCP_PRESETS) {
            if (preset.transport !== "http") continue;
            const cfg = preset.config as { url?: string };
            expect(() => new URL(cfg.url as string)).not.toThrow();
        }
    });

    // ---- Spot-check a few well-known presets by id (acts as the "lookup
    // helper" the catalogue doesn't itself export — .find() is all callers
    // need, so we exercise the exact shape a caller would rely on). ----

    it("filesystem: stdio preset with a path slot into args[2]", () => {
        const preset = MCP_PRESETS.find((p) => p.id === "filesystem");
        expect(preset).toBeDefined();
        expect(preset?.transport).toBe("stdio");
        expect(preset?.category).toBe("official");
        expect(preset?.slots).toEqual([{ path: "args[2]", label: "Allowed root path", kind: "path" }]);
        const cfg = preset?.config as { args?: string[] };
        expect(cfg.args?.[2]).toBe("<ALLOWED_PATH>");
    });

    it("github: stdio preset with a secret slot into env.GITHUB_PERSONAL_ACCESS_TOKEN", () => {
        const preset = MCP_PRESETS.find((p) => p.id === "github");
        expect(preset).toBeDefined();
        expect(preset?.transport).toBe("stdio");
        const cfg = preset?.config as { env?: Record<string, string> };
        expect(cfg.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("<GITHUB_TOKEN>");
        expect(preset?.slots.some((s) => s.path === "env.GITHUB_PERSONAL_ACCESS_TOKEN" && s.kind === "secret")).toBe(true);
    });

    it("github-remote: http preset with a secret slot into headers.Authorization", () => {
        const preset = MCP_PRESETS.find((p) => p.id === "github-remote");
        expect(preset).toBeDefined();
        expect(preset?.transport).toBe("http");
        const cfg = preset?.config as { url?: string; headers?: Record<string, string> };
        expect(cfg.url).toBe("https://api.githubcopilot.com/mcp/");
        expect(preset?.slots.some((s) => s.path === "headers.Authorization" && s.kind === "secret")).toBe(true);
    });

    it("presets with no fillable fields declare an empty slots array", () => {
        const preset = MCP_PRESETS.find((p) => p.id === "memory");
        expect(preset).toBeDefined();
        expect(preset?.slots).toEqual([]);
    });
});
