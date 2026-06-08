import "server-only";
import type { McpServerDTO } from "@/lib/schemas/mcp";
import { CALL_TIMEOUT_MS, getClient, withTimeout } from "./runtime";
import { qualify, type AggregatedTool } from "./dispatch";

/**
 * Thin wrappers over the MCP SDK's `client.X()` methods.
 *
 * Each wrapper:
 *   - acquires (or rebuilds) the cached client via runtime.getClient
 *   - applies CALL_TIMEOUT_MS so a stuck server can't hang the gateway
 *   - bumps lastUsed so the idle sweep treats the entry as fresh
 *   - returns plain JS shapes (no SDK types leak out)
 *
 * Adding a new MCP protocol call (e.g. `completion/complete`) lands
 * here — one function, same shape — with no impact on the runtime
 * lifecycle layer or the high-level dispatch path. Cache reads that
 * don't speak the protocol (e.g. `readServerInfo` for the cached
 * handshake values) stay in runtime.ts where the cache lives.
 */

/** List tools for a single server, surfaced as OpenAI tool shape. */
export async function listToolsForServer(server: McpServerDTO): Promise<AggregatedTool[]> {
    const cc = await getClient(server);
    const result = await withTimeout(cc.client.listTools(), CALL_TIMEOUT_MS, "tools/list");
    cc.lastUsed = Date.now();
    const out: AggregatedTool[] = [];
    for (const t of result.tools ?? []) {
        const parameters = (t.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
        };
        out.push({
            qualifiedName: qualify(server.name, t.name),
            localName: t.name,
            description: t.description ?? undefined,
            parameters,
            serverId: server.id,
            serverName: server.name,
        });
    }
    return out;
}

/** List static resources + URI templates for a server. Returns null
 *  when the server doesn't advertise the `resources` capability —
 *  saves an avoidable round-trip + a noisy "Method not found" error. */
export async function listResourcesForServer(server: McpServerDTO): Promise<{
    resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
    templates: Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }>;
} | null> {
    const cc = await getClient(server);
    const caps = cc.client.getServerCapabilities();
    if (!caps?.resources) return null;
    cc.lastUsed = Date.now();

    const resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }> = [];
    const templates: Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }> = [];

    try {
        const r = await withTimeout(cc.client.listResources(), CALL_TIMEOUT_MS, "resources/list");
        for (const x of r.resources ?? []) {
            resources.push({ uri: x.uri, name: x.name, description: x.description, mimeType: x.mimeType });
        }
    } catch { /* server may declare capability but not implement list */ }

    try {
        const r = await withTimeout(
            cc.client.listResourceTemplates(),
            CALL_TIMEOUT_MS,
            "resources/templates/list",
        );
        for (const x of r.resourceTemplates ?? []) {
            templates.push({
                uriTemplate: x.uriTemplate,
                name: x.name,
                description: x.description,
                mimeType: x.mimeType,
            });
        }
    } catch { /* templates are optional even when resources are supported */ }

    return { resources, templates };
}

/** List prompt templates for a server. Returns null when the server
 *  doesn't advertise the `prompts` capability. */
export async function listPromptsForServer(server: McpServerDTO): Promise<Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}> | null> {
    const cc = await getClient(server);
    const caps = cc.client.getServerCapabilities();
    if (!caps?.prompts) return null;
    cc.lastUsed = Date.now();

    const result = await withTimeout(cc.client.listPrompts(), CALL_TIMEOUT_MS, "prompts/list");
    return (result.prompts ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
        })),
    }));
}
