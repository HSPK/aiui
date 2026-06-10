import "server-only";
import type { McpServerDTO } from "@/lib/schemas/mcp";
import { TOOL_CONTENT_BUDGET_BYTES, TOOL_CONTENT_MARKER_RESERVE_BYTES } from "@/lib/schemas/content";
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

/** Tool invocation result — content is a flattened string. `serverName`
 *  is `null` for failures that couldn't be attributed to a real server
 *  (malformed qualified name from the model, unknown prefix). The FE
 *  renders a generic source badge in that case instead of pretending
 *  there's a server literally named "unknown". */
export interface ToolExecutionResult {
    content: string;
    isError: boolean;
    serverName: string | null;
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
 *  flaky server doesn't break the whole turn.
 *
 *  Hot-path optimisation: the most recent successful health-check
 *  writes the server's `tools/list` snapshot to `mcp_servers.tools_cache`
 *  alongside `last_check_at`. When that snapshot is fresh we can build
 *  the AggregatedTool[] from DB-resident JSON instead of spawning a
 *  stdio child or hitting the HTTP server — typically saving 100–500 ms
 *  per enabled server per chat turn. */
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000

function ageMs(iso: string | null | undefined): number {
    if (!iso) return Infinity
    const t = Date.parse(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z")
    if (Number.isNaN(t)) return Infinity
    return Date.now() - t
}

function aggregateFromCache(server: McpServerDTO): AggregatedTool[] | null {
    if (server.last_check_status !== "ok") return null
    if (ageMs(server.last_check_at) > TOOLS_CACHE_TTL_MS) return null
    const cached = server.tools_cache
    if (!cached) return null
    return cached.map((t) => ({
        qualifiedName: qualify(server.name, t.name),
        localName: t.name,
        description: t.description,
        parameters: t.parameters,
        serverId: server.id,
        serverName: server.name,
    }))
}

/** Hard cap on per-server `listToolsForServer` latency inside the
 *  aggregation. Without this, a cold MCP server that's mid-`npx`
 *  install would block the chat orchestrator for up to
 *  STDIO_CONNECT_TIMEOUT_MS (1 hour) BEFORE any response header
 *  reaches the user — reverse proxies (CF 100s, ALB 60s) 504 long
 *  before, with the user just seeing a hung send. 10s lets a warm
 *  reuse + tools/list complete easily while bounding the worst case.
 *
 *  Trade-off: the `Promise.race` cancels our await, NOT the underlying
 *  spawn. listToolsForServer continues to completion (cached for future
 *  callers). Today this is safe because dispatch passes no hooks —
 *  the orphan acquire/release inside listToolsForServer doesn't leak
 *  any extra resources. If a future contributor wires hooks into the
 *  chat dispatch path (e.g. surfacing MCP spawn logs to the user),
 *  this race-leaves-loser pattern needs an AbortSignal so the loser's
 *  refcount cleanup doesn't double-count against the entry. */
const AGGREGATE_TOOLS_PER_SERVER_TIMEOUT_MS = 10_000;

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
            // Fast path: serve from the persisted `tools_cache` snapshot
            // when fresh. Skips the MCP round-trip entirely.
            const cached = aggregateFromCache(s)
            if (cached) {
                tools.push(...cached)
                return
            }
            try {
                const t = await Promise.race([
                    listToolsForServer(s),
                    new Promise<AggregatedTool[]>((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Aggregation timeout after ${AGGREGATE_TOOLS_PER_SERVER_TIMEOUT_MS}ms — server not ready, skipping its tools this turn`)),
                            AGGREGATE_TOOLS_PER_SERVER_TIMEOUT_MS,
                        ),
                    ),
                ]);
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

/** Dispatch a single tool call by its qualified name. NEVER throws —
 *  every failure path (malformed name, unknown server, disabled server,
 *  JSON-parse error, RPC error, transport closed mid-call) returns a
 *  `ToolExecutionResult` with `isError: true`. Callers can treat the
 *  return as a sum-type and never need try/catch around it. This is
 *  load-bearing for the playground orchestrator: its `Promise.all` over
 *  pending tool calls runs in a `ReadableStream.start` async block, so
 *  any thrown rejection errors the controller and kills the SSE stream
 *  with no `loom_error` payload. */
export async function executeTool(
    qualifiedName: string,
    rawArgs: string,
): Promise<ToolExecutionResult> {
    const split = unqualify(qualifiedName);
    if (!split) {
        return {
            content: `Bad qualified tool name "${qualifiedName}" — expected "<server>__<tool>".`,
            isError: true,
            serverName: null,
        };
    }
    const server = listMcpServers().find((s) => sanitize(s.name) === split.serverPrefix);
    if (!server) {
        return {
            content: `No MCP server matches prefix "${split.serverPrefix}".`,
            isError: true,
            serverName: null,
        };
    }
    // Defence in depth — aggregateTools already filters disabled servers
    // out of the catalogue we hand to the model, so the model should
    // never call one. But a stale tool definition in the conversation
    // history (admin disabled mid-chat) could still trigger this path.
    if (!server.enabled) {
        return {
            content: `MCP server "${server.name}" is disabled.`,
            isError: true,
            serverName: server.name,
        };
    }

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

    let cc: Awaited<ReturnType<typeof getClient>> | null = null;
    try {
        cc = await getClient(server);
        const result = await withTimeout(
            cc.client.callTool({ name: split.toolName, arguments: args }),
            CALL_TIMEOUT_MS,
            `tools/call ${qualifiedName}`,
        );
        const flat = capToolContent(flattenContent(result.content as unknown));
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
    } finally {
        cc?.release();
    }
}

/** Tool results flow into `messages.content` JSON AND get replayed
 *  upstream on every subsequent turn within the history window. A
 *  `fetch`-style MCP returning a multi-MB web page would bloat the
 *  DB, blow the SSE payload to the FE, and exceed the upstream's
 *  context cap. Cap to fit inside the wire schema's `.max()` budget
 *  (256 KB) — reserve `TOOL_CONTENT_MARKER_RESERVE_BYTES` for the
 *  truncation marker so the function's OWN output never trips its
 *  own schema validator (the defense-in-depth mirror in
 *  `lib/schemas/content.ts`). Mirrors R1's user-input cap but for
 *  the SERVER-generated tool path. */
const MAX_TOOL_CONTENT_BYTES = TOOL_CONTENT_BUDGET_BYTES - TOOL_CONTENT_MARKER_RESERVE_BYTES;
function capToolContent(s: string): string {
    if (s.length <= MAX_TOOL_CONTENT_BYTES) return s;
    const truncated = s.slice(0, MAX_TOOL_CONTENT_BYTES);
    const dropped = s.length - MAX_TOOL_CONTENT_BYTES;
    return `${truncated}\n…[truncated, ${dropped} more bytes]`;
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
