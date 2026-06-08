import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
    McpHttpConfig,
    McpServerDTO,
    McpStdioConfig,
} from "@/lib/schemas/mcp";
import { listMcpServers } from "./service";

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
    /** Mangled name as exposed to the model: `<sanitizedServerName>__<toolName>`.
     *  Functions called by the LLM must round-trip through this name so we can
     *  look the server up again on tool_call. */
    qualifiedName: string;
    /** Original (server-local) tool name passed to `tools/call`. */
    localName: string;
    description?: string;
    parameters: Record<string, unknown>;
    serverId: string;
    serverName: string;
}

interface CachedClient {
    client: Client;
    /** Last time we successfully completed a request via this client.
     *  Eviction kicks in after IDLE_MS without use. */
    lastUsed: number;
    /** Config version (updated_at) at the time we built the client.
     *  Bumped via service update → next getClient sees a newer DB row
     *  and rebuilds the transport. Avoids a service ↔ runtime cycle. */
    builtFor: string;
    /** Per-entry identity sentinel used by the transport `onclose`
     *  callback to evict ONLY this entry — not a successor that
     *  replaced it mid-flight (config-version rebuild, manual
     *  re-check, etc.). */
    readonly tag: symbol;
    /** Disposer to terminate transport. */
    close: () => Promise<void>;
}

const IDLE_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;
/** Hard cap on the connection pool — if exceeded, the LRU entry is
 *  evicted on next admit. Prevents a misconfigured deployment with
 *  hundreds of MCP servers from spawning hundreds of child processes
 *  and exhausting fds / memory. */
const MAX_CACHED_CLIENTS = 50;
const NAME_MANGLE_SEP = "__";

const cache = new Map<string, CachedClient>();
const pending = new Map<string, Promise<CachedClient>>();

// =============================================================================
// Process-exit cleanup
// =============================================================================
//
// When the Next.js process gets SIGINT / SIGTERM (Ctrl-C, container stop, dev
// hot-reload restart), stdio MCP children would normally be reaped via the
// OS-level process tree cascade. That works for cleanup-on-death cases, but it
// (a) doesn't give the children a chance to flush state / close fds gracefully,
// and (b) leaves orphaned HTTP transport sockets dangling for a moment.
//
// Register a once-per-process disposer that walks the cache, calls each
// transport's `close()` with a short timeout so a stuck child can't block
// shutdown, and clears the cache. Idempotent — if multiple signals arrive we
// only dispose once. Globally tracked via a globalThis sentinel so the dev
// HMR re-import of this module doesn't re-register on every reload.

const SHUTDOWN_TIMEOUT_MS = 1_500;
const SHUTDOWN_KEY = Symbol.for("aiui.mcp.runtime.shutdownRegistered");

declare global {
    var __aiui_mcp_shutdown_registered__: boolean | undefined;
}

async function disposeAll(): Promise<void> {
    const entries = Array.from(cache.values());
    cache.clear();
    pending.clear();
    await Promise.all(
        entries.map((e) =>
            Promise.race([
                e.close().catch(() => undefined),
                new Promise((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS)),
            ]),
        ),
    );
}

if (typeof process !== "undefined" && !globalThis.__aiui_mcp_shutdown_registered__) {
    globalThis.__aiui_mcp_shutdown_registered__ = true;
    // Avoid `process.exit()` from the handler — return so other signal
    // listeners get to run too. Node will exit naturally once handlers settle.
    const handler = () => { void disposeAll(); };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
    process.once("beforeExit", handler);
    // Tag prevents a re-registration after `delete` (test harness); the
    // symbol-keyed property is invisible to enumeration.
    void SHUTDOWN_KEY;
}

function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
}

function qualify(serverName: string, toolName: string): string {
    return `${sanitize(serverName)}${NAME_MANGLE_SEP}${toolName}`;
}

function unqualify(qualifiedName: string): { serverPrefix: string; toolName: string } | null {
    const idx = qualifiedName.indexOf(NAME_MANGLE_SEP);
    if (idx <= 0) return null;
    return {
        serverPrefix: qualifiedName.slice(0, idx),
        toolName: qualifiedName.slice(idx + NAME_MANGLE_SEP.length),
    };
}

/** Child stderr cap for the captured buffer. Anything larger than this
 *  is dropped with a `…[truncated]` suffix; the persisted
 *  `last_check_error` column gets a further slice in checks.ts. */
const STDERR_CAP = 4096;

async function buildClient(server: McpServerDTO): Promise<CachedClient> {
    const client = new Client(
        { name: "aiui-gateway", version: "0.1.0" },
        { capabilities: {} },
    );
    const tag = Symbol(`mcp:${server.id}:${server.updated_at}`);

    /** Attach the eviction-on-close callback to a freshly-connected
     *  transport. When the child process dies (crash, kill, network
     *  hangup), the SDK fires onclose; we evict THIS entry only —
     *  comparing tags so a successor that replaced us mid-flight
     *  (config update / manual re-check) isn't accidentally removed. */
    const attachAutoEvict = (t: { onclose?: () => void }) => {
        t.onclose = () => {
            const entry = cache.get(server.id);
            if (entry && entry.tag === tag) cache.delete(server.id);
        };
    };

    let close: () => Promise<void>;
    if (server.transport === "stdio") {
        const cfg = server.config as unknown as McpStdioConfig;
        // `stderr: "pipe"` so we can attach a listener and surface the
        // child's stack trace in the connect/list error message. The
        // default ("inherit") writes to the server process's stderr —
        // useful in dev logs but invisible to the admin in the FE.
        const transport = new StdioClientTransport({
            command: cfg.command,
            args: cfg.args ?? [],
            env: cfg.env,
            cwd: cfg.cwd,
            stderr: "pipe",
        });
        let stderrBuffer = "";
        const stderr = transport.stderr;
        if (stderr) {
            // Attach BEFORE start() so early output (the most useful
            // kind — ENOENT, missing binary, bad arg) isn't lost. The
            // SDK guarantees the stream exists synchronously after the
            // ctor when stderr is "pipe".
            stderr.on("data", (chunk: Buffer | string) => {
                if (stderrBuffer.length >= STDERR_CAP) return;
                const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
                const room = STDERR_CAP - stderrBuffer.length;
                stderrBuffer += text.slice(0, room);
                if (text.length > room) stderrBuffer += "\n…[truncated]";
            });
        }

        try {
            await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "mcp connect");
        } catch (err) {
            // Give the child a beat to flush late stderr (the JSON-RPC
            // close usually fires before the OS-level error string
            // reaches us) before tearing down the transport.
            await new Promise((r) => setTimeout(r, 100));
            try { await transport.close(); } catch { /* ignore */ }
            throw enrichWithStderr(err, stderrBuffer);
        }

        attachAutoEvict(transport);
        close = async () => {
            try { await transport.close(); } catch { /* ignore */ }
        };
    } else {
        const cfg = server.config as unknown as McpHttpConfig;
        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
        });
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "mcp connect");
        attachAutoEvict(transport);
        close = async () => {
            try { await transport.close(); } catch { /* ignore */ }
        };
    }

    return { client, lastUsed: Date.now(), builtFor: server.updated_at, tag, close };
}

/** Compose the JSON-RPC error with the child's captured stderr so the
 *  admin sees both layers ("Connection closed" + the ENOENT trace
 *  that explains why it closed). Returns a fresh Error to avoid
 *  mutating the SDK's instance. */
function enrichWithStderr(err: unknown, stderrBuffer: string): Error {
    const baseMessage = err instanceof Error ? err.message : String(err);
    const trimmed = stderrBuffer.trim();
    if (!trimmed) return err instanceof Error ? err : new Error(baseMessage);
    const out = new Error(`${baseMessage}\n\n--- child stderr ---\n${trimmed}`);
    if (err instanceof Error && err.stack) out.stack = err.stack;
    return out;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function getClient(server: McpServerDTO): Promise<CachedClient> {
    const existing = cache.get(server.id);
    if (existing && existing.builtFor === server.updated_at) {
        existing.lastUsed = Date.now();
        return existing;
    }
    if (existing) {
        // Stale config — drop and rebuild.
        cache.delete(server.id);
        existing.close().catch(() => { /* ignore */ });
    }
    const inflight = pending.get(server.id);
    if (inflight) return inflight;

    const fresh = buildClient(server)
        .then((cc) => {
            evictLruIfFull();
            cache.set(server.id, cc);
            pending.delete(server.id);
            return cc;
        })
        .catch((err) => {
            pending.delete(server.id);
            throw err;
        });
    pending.set(server.id, fresh);
    return fresh;
}

function sweep() {
    const now = Date.now();
    for (const [id, entry] of cache) {
        if (now - entry.lastUsed > IDLE_MS) {
            cache.delete(id);
            entry.close().catch(() => { /* ignore */ });
        }
    }
}

/** Bound the cache size by evicting the least-recently-used entries
 *  whenever we're at or above the cap. Called before every admit so
 *  the cap is a hard ceiling regardless of access pattern. */
function evictLruIfFull() {
    if (cache.size < MAX_CACHED_CLIENTS) return;
    const sorted = Array.from(cache.entries()).sort(
        ([, a], [, b]) => a.lastUsed - b.lastUsed,
    );
    const toEvict = sorted.slice(0, cache.size - MAX_CACHED_CLIENTS + 1);
    for (const [id, entry] of toEvict) {
        cache.delete(id);
        entry.close().catch(() => { /* ignore */ });
    }
}

// =============================================================================
// Public API
// =============================================================================

/** Drop the cached client (called from CRUD updates/deletes so config
 *  changes take effect on the next call). */
export async function disposeMcpClient(serverId: string): Promise<void> {
    const entry = cache.get(serverId);
    if (!entry) return;
    cache.delete(serverId);
    await entry.close();
}

/** Read the server-reported identity from the initialize handshake
 *  (already completed when `connect()` resolved). Returns `null` for
 *  servers that supply no `serverInfo` / `instructions` / capabilities. */
export function readServerInfo(serverId: string): {
    name?: string;
    version?: string;
    instructions?: string;
    capabilities?: Record<string, unknown>;
} | null {
    const entry = cache.get(serverId);
    if (!entry) return null;
    const ver = entry.client.getServerVersion();
    const instructions = entry.client.getInstructions();
    const capabilities = entry.client.getServerCapabilities() as Record<string, unknown> | undefined;
    if (!ver && !instructions && !capabilities) return null;
    return {
        name: ver?.name,
        version: ver?.version,
        instructions,
        capabilities,
    };
}

/** List tools for a single server, surfaced as OpenAI tool shape. */
export async function listToolsForServer(server: McpServerDTO): Promise<AggregatedTool[]> {
    sweep();
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
export async function listResourcesForServer(
    server: McpServerDTO,
): Promise<{
    resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
    templates: Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }>;
} | null> {
    sweep();
    const cc = await getClient(server);
    const caps = cc.client.getServerCapabilities();
    if (!caps?.resources) return null;
    cc.lastUsed = Date.now();

    const resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }> = [];
    const templates: Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }> = [];

    try {
        const r = await withTimeout(cc.client.listResources(), CALL_TIMEOUT_MS, "resources/list");
        for (const x of r.resources ?? []) {
            resources.push({
                uri: x.uri,
                name: x.name,
                description: x.description,
                mimeType: x.mimeType,
            });
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
export async function listPromptsForServer(
    server: McpServerDTO,
): Promise<Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}> | null> {
    sweep();
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

/** Tool invocation result — content is a flattened string. */
export interface ToolExecutionResult {
    content: string;
    isError: boolean;
    serverName: string;
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

    sweep();
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

export { qualify as qualifyToolName, sanitize as sanitizeServerName };
