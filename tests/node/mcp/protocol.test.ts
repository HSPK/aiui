import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedMcpServer } from "../../helpers/db";
import { FakeHttpTransport, FakeMcpClient, FakeStdioTransport, resetFakeMcp } from "./_fake-mcp";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: FakeMcpClient }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: FakeStdioTransport }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: FakeHttpTransport }));
// Defense-in-depth backstops per the assignment: both transports above are
// fully replaced, so neither of these should ever actually run — but if a
// mock ever silently mismatches import resolution, these throw loudly
// instead of spawning a real process / hitting the real network.
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => {
        throw new Error("real node:child_process.spawn must never be called under test");
    }),
}));

import { getMcpServer } from "@/lib/server/mcp/service";
import { disposeMcpClient, forgetMcpServer } from "@/lib/server/mcp/runtime";
import {
    listPromptsForServer,
    listResourcesForServer,
    listToolsForServer,
} from "@/lib/server/mcp/protocol";

const realFetch = global.fetch;
const createdIds: string[] = [];

function makeHttpDto(overrides: Parameters<typeof seedMcpServer>[0] = {}) {
    const s = seedMcpServer({
        transport: "http",
        config: { url: "https://mcp.example.com/mcp" },
        enabled: true,
        ...overrides,
    });
    createdIds.push(s.id);
    return getMcpServer(s.id);
}

beforeEach(() => {
    resetDb();
    resetFakeMcp();
    createdIds.length = 0;
    global.fetch = vi.fn(async () => {
        throw new Error("real fetch must never be called under test");
    }) as unknown as typeof fetch;
});

afterEach(async () => {
    for (const id of createdIds.splice(0)) {
        await disposeMcpClient(id);
        forgetMcpServer(id);
    }
    global.fetch = realFetch;
    vi.useRealTimers();
});

describe("listToolsForServer", () => {
    it("maps the SDK's tools/list result into qualified AggregatedTool entries", async () => {
        const dto = makeHttpDto({ name: "toolsrv" });
        FakeMcpClient.nextScript = {
            toolsResult: {
                tools: [
                    { name: "search", description: "search the web", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
                ],
            },
        };
        const tools = await listToolsForServer(dto);
        expect(tools).toEqual([
            {
                qualifiedName: "toolsrv__search",
                localName: "search",
                description: "search the web",
                parameters: { type: "object", properties: { q: { type: "string" } } },
                serverId: dto.id,
                serverName: "toolsrv",
            },
        ]);
    });

    it("defaults parameters to an empty object schema when inputSchema is absent", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { toolsResult: { tools: [{ name: "no-schema" }] } };
        const [tool] = await listToolsForServer(dto);
        expect(tool.parameters).toEqual({ type: "object", properties: {} });
    });

    it("leaves description undefined when the server doesn't supply one", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { toolsResult: { tools: [{ name: "bare", inputSchema: {} }] } };
        const [tool] = await listToolsForServer(dto);
        expect(tool.description).toBeUndefined();
    });

    it("returns an empty array for a server with no tools", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { toolsResult: { tools: [] } };
        expect(await listToolsForServer(dto)).toEqual([]);
    });

    it("tolerates a malformed response with no `tools` key at all", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { toolsResult: {} };
        expect(await listToolsForServer(dto)).toEqual([]);
    });

    it("propagates a tools/list RPC failure (load-bearing, not swallowed here)", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { toolsError: new Error("upstream exploded") };
        await expect(listToolsForServer(dto)).rejects.toThrow("upstream exploded");
    });
});

describe("listResourcesForServer", () => {
    it("returns null without calling listResources/listResourceTemplates when the capability isn't advertised", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { capabilities: {} };
        const result = await listResourcesForServer(dto);
        expect(result).toBeNull();
        const instance = FakeMcpClient.instances.at(-1)!;
        expect(instance.listResourcesCalls).toBe(0);
        expect(instance.listResourceTemplatesCalls).toBe(0);
    });

    it("lists both resources and templates when the capability is advertised", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = {
            capabilities: { resources: {} },
            resourcesResult: { resources: [{ uri: "file:///a.txt", name: "a", description: "d", mimeType: "text/plain" }] },
            resourceTemplatesResult: { resourceTemplates: [{ uriTemplate: "file:///{id}.txt", name: "tpl" }] },
        };
        const result = await listResourcesForServer(dto);
        expect(result).toEqual({
            resources: [{ uri: "file:///a.txt", name: "a", description: "d", mimeType: "text/plain" }],
            templates: [{ uriTemplate: "file:///{id}.txt", name: "tpl", description: undefined, mimeType: undefined }],
        });
    });

    it("keeps resources when only listResourceTemplates fails (templates are optional even when resources are supported)", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = {
            capabilities: { resources: {} },
            resourcesResult: { resources: [{ uri: "file:///ok" }] },
            resourceTemplatesError: new Error("Method not found"),
        };
        const result = await listResourcesForServer(dto);
        expect(result?.resources).toEqual([{ uri: "file:///ok", name: undefined, description: undefined, mimeType: undefined }]);
        expect(result?.templates).toEqual([]);
    });

    it("keeps templates when only listResources fails", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = {
            capabilities: { resources: {} },
            resourcesError: new Error("Method not found"),
            resourceTemplatesResult: { resourceTemplates: [{ uriTemplate: "file:///{x}" }] },
        };
        const result = await listResourcesForServer(dto);
        expect(result?.resources).toEqual([]);
        expect(result?.templates).toHaveLength(1);
    });

    it("tolerates missing `resources`/`resourceTemplates` keys in the raw responses", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { capabilities: { resources: {} }, resourcesResult: {}, resourceTemplatesResult: {} };
        const result = await listResourcesForServer(dto);
        expect(result).toEqual({ resources: [], templates: [] });
    });
});

describe("listPromptsForServer", () => {
    it("returns null without calling listPrompts when the capability isn't advertised", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { capabilities: {} };
        const result = await listPromptsForServer(dto);
        expect(result).toBeNull();
        const instance = FakeMcpClient.instances.at(-1)!;
        expect(instance.listPromptsCalls).toBe(0);
    });

    it("maps prompts, arguments, and the required flag through", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = {
            capabilities: { prompts: {} },
            promptsResult: {
                prompts: [
                    {
                        name: "greet",
                        description: "say hi",
                        arguments: [{ name: "who", description: "target", required: true }, { name: "tone" }],
                    },
                ],
            },
        };
        const result = await listPromptsForServer(dto);
        expect(result).toEqual([
            {
                name: "greet",
                description: "say hi",
                arguments: [
                    { name: "who", description: "target", required: true },
                    { name: "tone", description: undefined, required: undefined },
                ],
            },
        ]);
    });

    it("tolerates a missing `prompts` key in the raw response", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { capabilities: { prompts: {} }, promptsResult: {} };
        expect(await listPromptsForServer(dto)).toEqual([]);
    });

    it("propagates a listPrompts RPC failure (not swallowed here — checks.ts is the one that catches it)", async () => {
        const dto = makeHttpDto();
        FakeMcpClient.nextScript = { capabilities: { prompts: {} }, promptsError: new Error("prompts boom") };
        await expect(listPromptsForServer(dto)).rejects.toThrow("prompts boom");
    });
});
