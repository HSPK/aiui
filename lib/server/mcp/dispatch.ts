import "server-only";
import { listMcpServers } from "./service";
import { CALL_TIMEOUT_MS, getClient, withTimeout } from "./runtime";
import { listToolsForServer } from "./protocol";

/**
 * Tool-aggregation + dispatch + name mangling.
 *
 * The MCP runtime can expose tools from multiple servers in a single
 * chat turn. To avoid name collisions and keep the dispatch path
 * deterministic, tool names are mangled `<sanitizedServerName>__<tool>`
 * before being handed to the model. When the model emits a tool_call
 * we reverse the mangle to find the right server + local tool name.
 *
 * Adding a new tool-dispatch feature (e.g. user-confirmation gating,
 * per-tool ACLs) lands in this file — protocol and runtime stay clean.
 */

const NAME_MANGLE_SEP = "__";

/** OpenAI chat-completion tools[] entry shape. */
export interface OpenAiTool {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}

/** A tool surfaced by the runtime, plus the originating server id so
 *  the gateway can dispatch the call back to the right MCP client. */
export interface AggregatedTool {
    /** Mangled name as exposed to the model: `<sanitizedServerName>__<toolName>`. */
    qualifiedName: string;
    /** Original (server-local) tool name passed to `tools/call`. */
    localName: string;
    description?: string;
    parameters: Record<string, unknown>;
    serverId: string;
    serverName: string;
}

/** Tool invocation result — content is a flattened string. */
export interface ToolExecutionResult {
    content: string;
    isError: boolean;
    serverName: string;
}

// ---- name mangling ----

export function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
}

export function qualify(serverName: string, toolName: string): string {
    return `${sanitize(serverName)}${NAME_MANGLE_SEP}${toolName}`;
}

export function unqualify(qualifiedName: string): { serverPrefix: string; toolName: string } | null {
    const idx = qualifiedName.indexOf(NAME_MANGLE_SEP);
    if (idx <= 0) return null;
    return {
        serverPrefix: qualifiedName.slice(0, idx),
        toolName: qualifiedName.slice(idx + NAME_MANGLE_SEP.length),
    };
}

// ---- aggregation + execution ----

/** Aggregate tools across the requested server ids. Failed servers are
 *  swallowed (with one toast-level message in the result) so a single
 *  flaky server doesn't break the whole turn. */
export async function aggregateTools(serverIds: string[]): Promise<{
    tools: AggregatedTool[];
    errors: Array<{ serverId: string; serverName: string; message: string }>;
}> {
    if (serverIds.length === 0) return { tools: [], errors: [] };
    const wanted = new Set(serverIds);
    const servers = listMcpServers().filter((s) => wanted.has(s.id) && s.enabled);

    const tools: AggregatedTool[] = [];
    const errors: Array<{ serverId: string; serverName: string; message: string }> = [];
    await Promise.all(
        servers.map(async (s) => {
            try {
                const t = await listToolsForServer(s);
                tools.push(...t);
            } catch (err) {
                errors.push({
                    serverId: s.id,
                    serverName: s.name,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }),
    );
    return { tools, errors };
}

/** Dispatch a single tool call by its qualified name. Throws when the
 *  qualified name cannot be resolved (the model hallucinated a server). */
export async function executeTool(
    qualifiedName: string,
    rawArgs: string,
): Promise<ToolExecutionResult> {
    const split = unqualify(qualifiedName);
    if (!split) throw new Error(`Bad qualified tool name "${qualifiedName}"`);
    const server = listMcpServers().find((s) => sanitize(s.name) === split.serverPrefix);
    if (!server) throw new Error(`No MCP server matches prefix "${split.serverPrefix}"`);

    let args: Record<string, unknown>;
    try {
        args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
        return {
            content: `Invalid JSON arguments from model: ${rawArgs.slice(0, 200)}`,
            isError: true,
            serverName: server.name,
        };
    }

    try {
        const cc = await getClient(server);
        const result = await withTimeout(
            cc.client.callTool({ name: split.toolName, arguments: args }),
            CALL_TIMEOUT_MS,
            `tools/call ${qualifiedName}`,
        );
        cc.lastUsed = Date.now();
        const flat = flattenContent(result.content as unknown);
        return {
            content: flat,
            isError: !!result.isError,
            serverName: server.name,
        };
    } catch (err) {
        return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
            serverName: server.name,
        };
    }
}

/** Convert MCP's structured content blocks to a single string the
 *  chat-completions API can consume in a `role: "tool"` message. We
 *  preserve textual blocks verbatim and tag non-text blocks (e.g.
 *  image/resource) so the model sees something useful. */
function flattenContent(content: unknown): string {
    if (!Array.isArray(content)) {
        if (typeof content === "string") return content;
        return JSON.stringify(content ?? "");
    }
    const out: string[] = [];
    for (const block of content) {
        const b = block as { type?: string; text?: string };
        if (b?.type === "text" && typeof b.text === "string") {
            out.push(b.text);
        } else {
            out.push(`[${b?.type ?? "unknown"}] ${JSON.stringify(block).slice(0, 200)}`);
        }
    }
    return out.join("\n") || "";
}

// Re-exports under the legacy public names for any external caller
// that imported them from `./runtime` before the split.
export { qualify as qualifyToolName, sanitize as sanitizeServerName };
