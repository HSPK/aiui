import { describe, expect, it } from "vitest";
import {
    mcpStdioConfigSchema,
    mcpHttpConfigSchema,
    mcpTransportSchema,
    mcpToolDescriptorSchema,
    mcpResourceDescriptorSchema,
    mcpResourceTemplateDescriptorSchema,
    mcpResourcesSnapshotSchema,
    mcpPromptDescriptorSchema,
    mcpServerInfoSchema,
    mcpServerDTOSchema,
    mcpRuntimeStatusSchema,
    mcpServerCreateSchema,
    mcpServerUpdateSchema,
    mcpPresetCategorySchema,
    mcpPresetSchema,
} from "@/lib/schemas/mcp";

describe("mcpStdioConfigSchema", () => {
    it("accepts a command-only config", () => {
        expect(mcpStdioConfigSchema.safeParse({ command: "npx" }).success).toBe(true);
    });

    it("accepts args, env and cwd", () => {
        const result = mcpStdioConfigSchema.safeParse({
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "secret" },
            cwd: "/workspace",
        });
        expect(result.success).toBe(true);
    });

    it("rejects an empty command", () => {
        const result = mcpStdioConfigSchema.safeParse({ command: "" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("command is required");
    });

    it("rejects a non-string env value", () => {
        const result = mcpStdioConfigSchema.safeParse({ command: "npx", env: { PORT: 3000 } });
        expect(result.success).toBe(false);
    });
});

describe("mcpHttpConfigSchema", () => {
    it("accepts and trims a valid url", () => {
        const result = mcpHttpConfigSchema.safeParse({ url: "  https://mcp.example.com/sse  " });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.url).toBe("https://mcp.example.com/sse");
    });

    it("rejects an empty url", () => {
        const result = mcpHttpConfigSchema.safeParse({ url: "" });
        expect(result.success).toBe(false);
    });

    it("rejects a non-URL string", () => {
        const result = mcpHttpConfigSchema.safeParse({ url: "not-a-url" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("url must be a valid URL");
    });

    it("accepts optional headers", () => {
        const result = mcpHttpConfigSchema.safeParse({
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer x" },
        });
        expect(result.success).toBe(true);
    });
});

describe("mcpTransportSchema", () => {
    it.each(["stdio", "http"])("accepts %s", (transport) => {
        expect(mcpTransportSchema.safeParse(transport).success).toBe(true);
    });

    it("rejects an unknown transport", () => {
        expect(mcpTransportSchema.safeParse("websocket").success).toBe(false);
    });
});

describe("mcpToolDescriptorSchema", () => {
    it("accepts a minimal tool descriptor", () => {
        const result = mcpToolDescriptorSchema.safeParse({ name: "search", parameters: {} });
        expect(result.success).toBe(true);
    });

    it("rejects a missing parameters field", () => {
        expect(mcpToolDescriptorSchema.safeParse({ name: "search" }).success).toBe(false);
    });
});

describe("mcpResourceDescriptorSchema / mcpResourceTemplateDescriptorSchema", () => {
    it("accepts a minimal resource descriptor", () => {
        expect(mcpResourceDescriptorSchema.safeParse({ uri: "file:///a.txt" }).success).toBe(true);
    });

    it("accepts optional name/description/mimeType", () => {
        const result = mcpResourceDescriptorSchema.safeParse({
            uri: "file:///a.txt",
            name: "a",
            description: "desc",
            mimeType: "text/plain",
        });
        expect(result.success).toBe(true);
    });

    it("accepts a minimal resource template descriptor", () => {
        expect(mcpResourceTemplateDescriptorSchema.safeParse({ uriTemplate: "file:///{path}" }).success).toBe(true);
    });

    it("rejects a template missing uriTemplate", () => {
        expect(mcpResourceTemplateDescriptorSchema.safeParse({}).success).toBe(false);
    });
});

describe("mcpResourcesSnapshotSchema", () => {
    it("accepts empty resources/templates arrays", () => {
        expect(mcpResourcesSnapshotSchema.safeParse({ resources: [], templates: [] }).success).toBe(true);
    });

    it("accepts populated resources/templates arrays", () => {
        const result = mcpResourcesSnapshotSchema.safeParse({
            resources: [{ uri: "file:///a.txt" }],
            templates: [{ uriTemplate: "file:///{path}" }],
        });
        expect(result.success).toBe(true);
    });

    it("rejects a malformed nested resource", () => {
        const result = mcpResourcesSnapshotSchema.safeParse({ resources: [{}], templates: [] });
        expect(result.success).toBe(false);
    });
});

describe("mcpPromptDescriptorSchema", () => {
    it("accepts a minimal prompt descriptor", () => {
        expect(mcpPromptDescriptorSchema.safeParse({ name: "summarize" }).success).toBe(true);
    });

    it("accepts arguments with a required flag", () => {
        const result = mcpPromptDescriptorSchema.safeParse({
            name: "summarize",
            description: "Summarize text",
            arguments: [{ name: "text", description: "input text", required: true }],
        });
        expect(result.success).toBe(true);
    });

    it("rejects an argument missing its name", () => {
        const result = mcpPromptDescriptorSchema.safeParse({ name: "summarize", arguments: [{ required: true }] });
        expect(result.success).toBe(false);
    });
});

describe("mcpServerInfoSchema", () => {
    it("accepts an empty object", () => {
        expect(mcpServerInfoSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a fully populated server info", () => {
        const result = mcpServerInfoSchema.safeParse({
            name: "github-mcp",
            version: "1.0.0",
            instructions: "Use responsibly",
            capabilities: { tools: {}, resources: { subscribe: true } },
        });
        expect(result.success).toBe(true);
    });
});

describe("mcpServerDTOSchema", () => {
    const valid = {
        id: "srv-1",
        name: "github",
        description: "GitHub MCP server",
        transport: "stdio" as const,
        config: { command: "npx", args: ["-y", "server-github"] },
        enabled: true,
        last_check_status: null,
        last_check_at: null,
        last_check_error: null,
        tools_cache: null,
        resources_cache: null,
        prompts_cache: null,
        server_info: null,
        config_version: "v1",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
    };

    it("parses a minimal valid DTO with all caches null", () => {
        expect(mcpServerDTOSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts config_decryption_failed as an optional flag", () => {
        expect(mcpServerDTOSchema.safeParse({ ...valid, config_decryption_failed: true }).success).toBe(true);
    });

    it("accepts populated caches and server_info", () => {
        const result = mcpServerDTOSchema.safeParse({
            ...valid,
            last_check_status: "ok",
            last_check_at: "2024-01-02T00:00:00.000Z",
            tools_cache: [{ name: "search", parameters: {} }],
            resources_cache: { resources: [], templates: [] },
            prompts_cache: [{ name: "summarize" }],
            server_info: { name: "github-mcp" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid last_check_status", () => {
        expect(mcpServerDTOSchema.safeParse({ ...valid, last_check_status: "warning" }).success).toBe(false);
    });

    it("rejects a missing config_version", () => {
        const { config_version, ...rest } = valid;
        expect(mcpServerDTOSchema.safeParse(rest).success).toBe(false);
    });
});

describe("mcpRuntimeStatusSchema", () => {
    const valid = {
        server_id: "srv-1",
        status: "idle" as const,
        pid: null,
        started_at: null,
        built_for: null,
        error: null,
        recent_logs: [],
    };

    it("parses a valid idle status", () => {
        expect(mcpRuntimeStatusSchema.safeParse(valid).success).toBe(true);
    });

    it("parses a connected status with a pid and logs", () => {
        const result = mcpRuntimeStatusSchema.safeParse({
            ...valid,
            status: "connected",
            pid: 1234,
            started_at: "2024-01-01T00:00:00.000Z",
            built_for: "2024-01-01T00:00:00.000Z",
            recent_logs: ["started", "connected"],
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid status", () => {
        expect(mcpRuntimeStatusSchema.safeParse({ ...valid, status: "unknown" }).success).toBe(false);
    });

    it("rejects a non-integer pid", () => {
        expect(mcpRuntimeStatusSchema.safeParse({ ...valid, pid: 1.5 }).success).toBe(false);
    });
});

describe("mcpServerCreateSchema", () => {
    it("accepts a valid stdio server", () => {
        const result = mcpServerCreateSchema.safeParse({
            name: "github",
            transport: "stdio",
            config: { command: "npx", args: ["-y", "server-github"] },
        });
        expect(result.success).toBe(true);
    });

    it("accepts a valid http server", () => {
        const result = mcpServerCreateSchema.safeParse({
            name: "remote",
            transport: "http",
            config: { url: "https://mcp.example.com" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects an empty name before config is even checked", () => {
        const result = mcpServerCreateSchema.safeParse({
            name: "",
            transport: "stdio",
            config: { command: "npx" },
        });
        expect(result.success).toBe(false);
    });

    it("rejects a stdio transport with an http-shaped config, prefixing issues under 'config'", () => {
        const result = mcpServerCreateSchema.safeParse({
            name: "github",
            transport: "stdio",
            config: { url: "https://mcp.example.com" },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.path[0] === "config");
            expect(issue).toBeDefined();
            expect(issue?.path).toEqual(["config", "command"]);
        }
    });

    it("rejects an http transport with a stdio-shaped config, prefixing issues under 'config'", () => {
        const result = mcpServerCreateSchema.safeParse({
            name: "remote",
            transport: "http",
            config: { command: "npx" },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.path[0] === "config");
            expect(issue).toBeDefined();
            expect(issue?.path).toEqual(["config", "url"]);
        }
    });

    it("accepts an optional description and enabled flag", () => {
        const result = mcpServerCreateSchema.safeParse({
            name: "github",
            description: "GitHub MCP",
            transport: "stdio",
            config: { command: "npx" },
            enabled: false,
        });
        expect(result.success).toBe(true);
    });
});

describe("mcpServerUpdateSchema", () => {
    it("accepts an empty object", () => {
        expect(mcpServerUpdateSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a name-only rename", () => {
        expect(mcpServerUpdateSchema.safeParse({ name: "renamed" }).success).toBe(true);
    });

    it("skips config validation when transport is provided without config", () => {
        const result = mcpServerUpdateSchema.safeParse({ transport: "http" });
        expect(result.success).toBe(true);
    });

    it("skips config validation when config is provided without transport", () => {
        // Not a real-world use case (config alone is ambiguous) but the schema
        // intentionally defers validation until both fields are present.
        const result = mcpServerUpdateSchema.safeParse({ config: { anything: "goes" } });
        expect(result.success).toBe(true);
    });

    it("validates config against transport when both are provided", () => {
        const result = mcpServerUpdateSchema.safeParse({
            transport: "http",
            config: { command: "npx" },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].path).toEqual(["config", "url"]);
        }
    });

    it("accepts a valid transport+config pair", () => {
        const result = mcpServerUpdateSchema.safeParse({
            transport: "stdio",
            config: { command: "npx" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects an empty name when explicitly provided", () => {
        expect(mcpServerUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    });
});

describe("mcpPresetCategorySchema", () => {
    it.each(["official", "system", "dev", "academic", "data", "web", "productivity", "community"])(
        "accepts %s",
        (category) => {
            expect(mcpPresetCategorySchema.safeParse(category).success).toBe(true);
        },
    );

    it("rejects an unknown category", () => {
        expect(mcpPresetCategorySchema.safeParse("misc").success).toBe(false);
    });
});

describe("mcpPresetSchema", () => {
    const base = {
        id: "github",
        name: "GitHub",
        description: "GitHub MCP server",
        transport: "stdio" as const,
        config: { command: "npx", args: ["-y", "server-github"], env: { GITHUB_TOKEN: "<GITHUB_TOKEN>" } },
    };

    it("defaults slots to [] and category to 'community' when omitted", () => {
        const result = mcpPresetSchema.parse(base);
        expect(result.slots).toEqual([]);
        expect(result.category).toBe("community");
    });

    it("accepts explicit slots with each kind", () => {
        const result = mcpPresetSchema.safeParse({
            ...base,
            slots: [
                { path: "env.GITHUB_TOKEN", label: "GitHub Token", kind: "secret" },
                { path: "args[2]", label: "Allowed path", kind: "path" },
                { path: "args[3]", label: "Note", kind: "text" },
            ],
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid slot kind", () => {
        const result = mcpPresetSchema.safeParse({
            ...base,
            slots: [{ path: "env.X", label: "X", kind: "hidden" }],
        });
        expect(result.success).toBe(false);
    });

    it("accepts an optional homepage and explicit category", () => {
        const result = mcpPresetSchema.safeParse({
            ...base,
            homepage: "https://github.com/example/mcp-server",
            category: "official",
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid category", () => {
        expect(mcpPresetSchema.safeParse({ ...base, category: "bogus" }).success).toBe(false);
    });
});
