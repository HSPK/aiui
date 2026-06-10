import "server-only";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
    McpHttpConfig,
    McpServerDTO,
    McpStdioConfig,
} from "@/lib/schemas/mcp";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import { appendMcpLog, closeMcpLogWriter } from "./logs";

/** Live DB read of just the `enabled` flag — bypasses the snapshot
 *  staleness that bit us when a `PATCH {enabled:false, config:{...}}`
 *  landed mid-runMcpCheck. The runtime owns the "don't spawn for
 *  disabled servers" policy because that policy applies to ALL build
 *  paths (interactive check, chat dispatch, background validation). */
function isServerEnabledInDb(serverId: string): boolean {
    const row = db
        .select({ enabled: mcpServers.enabled })
        .from(mcpServers)
        .where(eq(mcpServers.id, serverId))
        .get();
    return !!row?.enabled;
}

// Re-export sibling modules under the historical `./runtime` import
// path so existing callers (checks.ts, gateway, FE-facing route
// handlers) don't need to update import sites. Splitting this file
// into runtime / protocol / dispatch is an internal refactor only.
export type { OpenAiTool, AggregatedTool, ToolExecutionResult } from "./dispatch";
export {
    aggregateTools,
    executeTool,
    sanitize as sanitizeServerName,
    qualify as qualifyToolName,
} from "./dispatch";
export {
    listToolsForServer,
    listResourcesForServer,
    listPromptsForServer,
} from "./protocol";

// =============================================================================
// State machine
// =============================================================================
//
// One ServerEntry per server.id. The entry IS the canonical state for that
// server's runtime presence — every consumer (re-check from UI, chat tool
// dispatch, background re-check after CRUD update) reads and mutates the
// SAME entry. This eliminates the prior bugs:
//
//   * Idle eviction wastefully killed processes after 5 min, so the next
//     call paid the full `npx`/`uvx` install cost again.
//   * `checkMcpServer` deliberately disposed the cached client before each
//     re-check, also forcing a respawn even when nothing was wrong.
//   * Concurrent `getClient` calls couldn't share an in-flight connect's
//     hook subscriptions — the second caller's SSE log stream stayed empty
//     while the first owned the spawn.
//   * `disposeMcpClient` only touched `cache`, leaving `pending` builds
//     unaware that they should bail.
//
// New invariants:
//
//   1. At most ONE child process per server.id at any time (singleflight).
//   2. Connections survive until: config row's configVersion changes,
//      explicit teardown (delete / disable), LRU eviction past
//      MAX_ACTIVE_CLIENTS, or unexpected transport close. Idle time alone
//      never kills.
//   3. Concurrent callers join the same connectPromise AND get their hooks
//      composed in — every subscriber receives every spawning phase + log.
//      Joiners that arrive AFTER a phase fired also get a replay so their
//      UI timeline is coherent.
//   4. Unexpected transport close marks the entry `failed`; the next
//      getClient transparently rebuilds (no orphaned state).
//   5. Reference counting around the live client: tear-down (config
//      change, LRU evict, admin Stop) DETACHES the connection from the
//      entry and marks it pending-close; the actual `transport.close()`
//      fires only after the last in-flight RPC releases. Tool calls
//      mid-dispose finish cleanly instead of seeing "Connection closed".

type Status = "idle" | "connecting" | "connected" | "failed";

interface ConnectedClient {
    client: Client;
    /** ConfigVersion the connection was built against. Mismatch with
     *  the live row's configVersion triggers a transparent rebuild on
     *  the next getClient. */
    builtFor: string;
    /** Per-build identity — protects against a stale onclose firing
     *  after a successor connection has already replaced this one. */
    session: symbol;
    /** Disposer for the transport's child process / socket. Calls
     *  removeAllListeners on stderr + clears onclose synchronously
     *  before awaiting transport.close — so a late PassThrough flush
     *  can't resurrect log writes for a tombstoned server. */
    close: () => Promise<void>;
    /** Monotonic timestamp for LRU eviction ordering. */
    lastUsed: number;
    /** Child process PID — only populated for stdio transports. */
    pid: number | null;
    /** ISO timestamp of the successful connect handshake. */
    startedAt: string;
    /** Refcount of in-flight RPC operations. Bumped by `acquire`,
     *  decremented by `release`. When `pendingClose` is set and refs
     *  drops to 0, `close` is invoked. */
    refs: number;
    /** True after softClose detached this client from its entry. Once
     *  set, refs->0 triggers the actual transport teardown. New
     *  callers will not see this client (it's been removed from
     *  e.connected); only callers holding existing handles do. */
    pendingClose: boolean;
}

interface ServerEntry {
    serverId: string;
    status: Status;
    /** Populated when status === "connected". */
    connected: ConnectedClient | null;
    /** Populated when status === "failed". */
    error: string | null;
    /** In-flight build — concurrent getClient callers await this AND
     *  contribute their hooks to `connectHooks` for the duration. */
    connectPromise: Promise<ConnectedClient> | null;
    /** Subscribers to the in-flight build. Each entry receives phase +
     *  log events from the same spawning child. Cleared once connect
     *  resolves. */
    connectHooks: BuildClientHooks[];
    /** Replay buffer for joiners — phases that have already fired in
     *  this build are immediately re-emitted to a newly-subscribed
     *  hook so the joiner's UI sees a coherent timeline instead of
     *  starting at whatever phase happens to be live. */
    phaseHistory: McpCheckPhase[];
}

// =============================================================================
// HMR-safe state — survives Next.js dev re-imports
// =============================================================================

declare global {
    var __loom_mcp_servers__: Map<string, ServerEntry> | undefined;
    var __loom_mcp_spawning__: Set<{ close: () => Promise<void> }> | undefined;
    var __loom_mcp_shutdown_registered__: boolean | undefined;
}

/** Module-local state for the runtime. Cached on globalThis under the
 *  same pattern as `db/index.ts` so a dev HMR re-import doesn't park
 *  the prior generation's child processes in a forgotten Map. */
const servers: Map<string, ServerEntry> = globalThis.__loom_mcp_servers__ ?? new Map();
/** Set of transports that have been spawned but haven't finished
 *  connect — we need to be able to close them from the SIGTERM
 *  handler even though they haven't reached `e.connected` yet. */
const spawningTransports: Set<{ close: () => Promise<void> }> =
    globalThis.__loom_mcp_spawning__ ?? new Set();
if (process.env.NODE_ENV !== "production") {
    globalThis.__loom_mcp_servers__ = servers;
    globalThis.__loom_mcp_spawning__ = spawningTransports;
}

/** Connect = transport.start() + JSON-RPC initialize handshake.
 *  Stdio includes time for `npx`/`uvx`/`bunx` to download the server
 *  package on first run — slow networks can easily blow past 15s, so
 *  we give stdio a much wider window. Pure-HTTP keeps the snappy
 *  default since there's no install step. Both are overridable
 *  per-call via `BuildClientOpts.connectTimeoutMs` (driven by the
 *  user's `mcp_connect_timeout_seconds` preference). */
const HTTP_CONNECT_TIMEOUT_MS = 15_000;
const STDIO_CONNECT_TIMEOUT_MS = 60 * 60 * 1000;
const CALL_TIMEOUT_MS = 60_000;
/** Hard cap on the number of simultaneously-alive child processes /
 *  HTTP sockets. When a fresh connect would push us past this we
 *  evict the LRU entry. Idle entries are NEVER evicted by time alone
 *  — long-lived MCP servers are the common case and we deliberately
 *  avoid the wasteful respawn pattern of the old IDLE_MS sweep. */
const MAX_ACTIVE_CLIENTS = 50;

/** Child stderr cap for the captured buffer. Anything larger than this
 *  is dropped with a `…[truncated]` suffix; the persisted
 *  `last_check_error` column gets a further slice in checks.ts. */
const STDERR_CAP = 4096;

// =============================================================================
// Hook contracts
// =============================================================================

/** Hooks for the SSE check path: stream stderr lines to the FE in
 *  real time, surface the phase transitions admins care about, and
 *  let the runtime react when the child dies after we've handed the
 *  cached client out. All optional — passing nothing keeps the
 *  original silent behaviour. */
export interface BuildClientHooks {
    onLog?: (line: string) => void;
    onPhase?: (phase: McpCheckPhase) => void;
    /** Fires when the transport closes UNEXPECTEDLY (child crashed,
     *  network hangup) — not during an admin-initiated dispose. The
     *  runtime uses this internally to mark the entry as failed; SSE
     *  callers can ignore it. */
    onUnexpectedClose?: () => void;
}

/** Per-call overrides for buildClient. `connectTimeoutMs` lets a
 *  caller (e.g. the user-facing /check route consulting their
 *  `mcp_connect_timeout_seconds` preference) widen or tighten the
 *  default budget for the initialize handshake. */
export interface BuildClientOpts {
    connectTimeoutMs?: number;
}

export type McpCheckPhase = "spawning" | "starting" | "connecting" | "ready";

// =============================================================================
// Process-exit cleanup
// =============================================================================

const SHUTDOWN_TIMEOUT_MS = 5_000;
let shuttingDown = false;

async function disposeAll(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    // Snapshot — disposeMcpClient mutates `servers`.
    const entries = Array.from(servers.values());
    const spawning = Array.from(spawningTransports);
    spawningTransports.clear();

    // Kill any pre-connect transports first — they're holding child
    // processes that haven't reached our cached state yet, so the
    // entries.connected path won't find them. Concurrent: race them
    // against the global timeout so a stuck `npx` install can't
    // block shutdown.
    const allCloses: Promise<unknown>[] = [];
    for (const t of spawning) {
        allCloses.push(
            Promise.race([
                t.close().catch(() => undefined),
                new Promise((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS)),
            ]),
        );
    }
    for (const e of entries) {
        const cc = e.connected;
        if (!cc) continue;
        // Skip refcount — we're going down regardless.
        allCloses.push(
            Promise.race([
                cc.close().catch(() => undefined),
                new Promise((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS)),
            ]),
        );
    }
    servers.clear();

    await Promise.all(allCloses);
}

if (typeof process !== "undefined" && !globalThis.__loom_mcp_shutdown_registered__) {
    globalThis.__loom_mcp_shutdown_registered__ = true;
    // SIGINT/SIGTERM handlers run alongside other listeners. Node
    // keeps the process alive while our `disposeAll()` is pending
    // (it has unresolved Promise.all + setTimeouts), so children are
    // reaped before the parent exits. We deliberately DON'T call
    // process.exit() — let the event loop drain naturally.
    const handler = () => { void disposeAll(); };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
    process.once("beforeExit", handler);
}

// =============================================================================
// Reference counting
// =============================================================================
//
// Tear-down of a live ConnectedClient can be delayed when callers are still
// mid-RPC. `acquire` bumps the count when getClient hands out a handle;
// `release` decrements when the caller is done. `softClose` sets the
// `pendingClose` flag and either closes immediately (refs===0) or defers
// until the last `release`.
//
// `softClose` also DETACHES the client from its entry (sets e.connected =
// null) so future getClient calls go through a fresh build path and don't
// re-acquire a connection that's marked for retirement.

function acquire(cc: ConnectedClient): ConnectedClient {
    cc.refs++;
    cc.lastUsed = Date.now();
    return cc;
}

function release(cc: ConnectedClient): void {
    cc.refs--;
    if (cc.refs <= 0 && cc.pendingClose) {
        // Fire and forget — the close path has its own try/catch.
        // Caller of release() shouldn't have to await IO.
        cc.close().catch(() => { /* ignore */ });
    }
}

/** Detach a client from the entry that owns it AND mark it for
 *  retirement. Refs-aware: if no in-flight RPCs, closes immediately;
 *  otherwise the close fires when the last RPC releases. */
function softClose(e: ServerEntry, cc: ConnectedClient): void {
    if (e.connected === cc) {
        e.connected = null;
        // Don't downgrade status when a successor is being built —
        // caller decides what status the entry should land in.
    }
    cc.pendingClose = true;
    if (cc.refs <= 0) {
        cc.close().catch(() => { /* ignore */ });
    }
}

// =============================================================================
// buildClient — spawns / connects ONE transport
// =============================================================================

async function buildClient(
    server: McpServerDTO,
    hooks: BuildClientHooks = {},
    opts: BuildClientOpts = {},
): Promise<ConnectedClient> {
    const client = new Client(
        { name: "loom-gateway", version: "0.1.0" },
        { capabilities: {} },
    );
    const session = Symbol(`mcp:${server.id}:${server.config_version}`);

    /** Wire the transport's `onclose` to the runtime's lifecycle hook.
     *  When the child process dies unexpectedly (crash, kill, network
     *  hangup), the SDK fires onclose; we re-dispatch via
     *  `hooks.onUnexpectedClose` so the entry's state machine can
     *  flip to `failed`.
     *
     *  CRITICAL: must be attached BEFORE `client.connect(transport)`.
     *  The SDK's `Protocol.connect()` captures `transport.onclose` and
     *  wraps it with its own `_onclose()` which (a) rejects every
     *  pending `_responseHandlers` entry with `McpError` and (b)
     *  clears per-request timeouts. If we attach AFTER connect, we
     *  clobber that wrapper — and when the child crashes, in-flight
     *  `client.callTool()` / `listTools()` calls never settle until
     *  the per-call 60s `withTimeout` fires, stalling
     *  `disposeMcpClient` and stranding the user behind a long hang.
     *  Chain instead of overwrite via the `_onclose ?? prev` capture
     *  pattern the SDK uses. */
    const attachUnexpectedClose = (t: { onclose?: () => void }) => {
        const prev = t.onclose;
        t.onclose = () => {
            try { prev?.(); } catch { /* ignore */ }
            hooks.onUnexpectedClose?.();
        };
    };

    let close: () => Promise<void>;
    let pid: number | null = null;

    if (server.transport === "stdio") {
        const cfg = server.config as unknown as McpStdioConfig;
        const connectTimeoutMs = opts.connectTimeoutMs ?? STDIO_CONNECT_TIMEOUT_MS;
        appendMcpLog(server.id, "lifecycle", `spawning command=${cfg.command} args=${JSON.stringify(cfg.args ?? [])}`);
        hooks.onPhase?.("spawning");
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
        // Register the in-flight transport so the SIGTERM handler can
        // kill it even before connect resolves. Unregistered below
        // after a successful connect (the entry's `connected.close`
        // takes over) or in the catch (the failed transport is
        // already torn down).
        const spawningHandle = { close: () => transport.close() };
        spawningTransports.add(spawningHandle);

        let stderrBuffer = "";
        const stderr = transport.stderr;
        // Capture handlers so close() can detach them — without this,
        // post-close PassThrough flushes would call appendMcpLog →
        // openWriter and resurrect a tombstoned log file with an
        // orphan fd no future dispose can reclaim.
        let stderrDataHandler: ((chunk: Buffer | string) => void) | null = null;
        let stderrEndHandler: (() => void) | null = null;
        if (stderr) {
            // Line-buffer the stderr chunks so the SSE consumer gets
            // one event per logical log line, even when the child
            // batches writes (npm download progress, uvx install).
            let pending = "";
            const emitLine = (line: string) => {
                if (!line) return;
                if (stderrBuffer.length < STDERR_CAP) {
                    const room = STDERR_CAP - stderrBuffer.length;
                    stderrBuffer += line.slice(0, room) + "\n";
                    if (line.length > room) stderrBuffer += "…[truncated]\n";
                }
                appendMcpLog(server.id, "stderr", line);
                hooks.onLog?.(line);
            };
            stderrDataHandler = (chunk: Buffer | string) => {
                pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
                let nl = pending.indexOf("\n");
                while (nl !== -1) {
                    emitLine(pending.slice(0, nl).replace(/\r$/, ""));
                    pending = pending.slice(nl + 1);
                    nl = pending.indexOf("\n");
                }
            };
            stderrEndHandler = () => {
                if (pending) {
                    emitLine(pending.replace(/\r$/, ""));
                    pending = "";
                }
            };
            stderr.on("data", stderrDataHandler);
            stderr.on("end", stderrEndHandler);
        }

        appendMcpLog(server.id, "lifecycle", "starting");
        hooks.onPhase?.("starting");
        // Attach BEFORE connect so the SDK's Protocol.connect can
        // chain on top of our handler (see attachUnexpectedClose
        // comment). Without this, pending RPCs hang ~60s on child
        // crash before timing out, instead of rejecting immediately.
        attachUnexpectedClose(transport);
        try {
            // The SDK's `connect()` covers spawn → initialize handshake
            // in one shot. For stdio that handshake is blocked until
            // `npx`/`uvx` finishes downloading the server package on a
            // cold cache, so the timeout has to be generous.
            appendMcpLog(server.id, "lifecycle", "connecting");
            hooks.onPhase?.("connecting");
            await withTimeout(client.connect(transport), connectTimeoutMs, "mcp connect");
            pid = transport.pid ?? null;
            appendMcpLog(server.id, "lifecycle", `ready pid=${pid ?? "?"}`);
            hooks.onPhase?.("ready");
        } catch (err) {
            spawningTransports.delete(spawningHandle);
            // Give the child a beat to flush late stderr (the JSON-RPC
            // close usually fires before the OS-level error string
            // reaches us) before tearing down the transport.
            await new Promise((r) => setTimeout(r, 100));
            if (stderr && stderrDataHandler) stderr.removeListener("data", stderrDataHandler);
            if (stderr && stderrEndHandler) stderr.removeListener("end", stderrEndHandler);
            try { await transport.close(); } catch { /* ignore */ }
            const msg = err instanceof Error ? err.message : String(err);
            appendMcpLog(server.id, "lifecycle", `connect_failed reason=${msg}`);
            throw enrichWithStderr(err, stderrBuffer);
        }

        spawningTransports.delete(spawningHandle);
        let closed = false;
        close = async () => {
            // Idempotency latch — softClose, release, evict, dispose
            // force-close path, and the unexpected-close handler can
            // all converge on this function. Guard so transport.close
            // / removeListener don't run twice in pathological cases.
            if (closed) return;
            closed = true;
            // Detach stderr handlers synchronously BEFORE we await
            // transport.close — between the await and the SDK's
            // actual close event there's a window where the
            // PassThrough can still flush queued chunks, and we
            // don't want those to fire user-facing hooks or
            // resurrect log files.
            //
            // Do NOT detach transport.onclose — the SDK's chained
            // handler must run on close() to reject any in-flight
            // RPCs. Our chained `hooks.onUnexpectedClose` no-ops on
            // already-disposed entries.
            if (stderr && stderrDataHandler) stderr.removeListener("data", stderrDataHandler);
            if (stderr && stderrEndHandler) stderr.removeListener("end", stderrEndHandler);
            try { await transport.close(); } catch { /* ignore */ }
        };
    } else {
        const cfg = server.config as unknown as McpHttpConfig;
        const connectTimeoutMs = opts.connectTimeoutMs ?? HTTP_CONNECT_TIMEOUT_MS;
        appendMcpLog(server.id, "lifecycle", `connecting url=${cfg.url}`);
        hooks.onPhase?.("connecting");
        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
        });
        const spawningHandle = { close: () => transport.close() };
        spawningTransports.add(spawningHandle);
        // Attach BEFORE connect — see stdio path comment above.
        attachUnexpectedClose(transport);
        try {
            await withTimeout(client.connect(transport), connectTimeoutMs, "mcp connect");
        } catch (err) {
            spawningTransports.delete(spawningHandle);
            const msg = err instanceof Error ? err.message : String(err);
            appendMcpLog(server.id, "lifecycle", `connect_failed reason=${msg}`);
            throw err;
        }
        spawningTransports.delete(spawningHandle);
        appendMcpLog(server.id, "lifecycle", "ready");
        hooks.onPhase?.("ready");
        let closedHttp = false;
        close = async () => {
            if (closedHttp) return;
            closedHttp = true;
            // Same reasoning as stdio close() — keep transport.onclose
            // chained so SDK can reject pending RPCs on close.
            try { await transport.close(); } catch { /* ignore */ }
        };
    }

    return {
        client,
        builtFor: server.config_version,
        session,
        close,
        lastUsed: Date.now(),
        pid,
        startedAt: new Date().toISOString(),
        refs: 0,
        pendingClose: false,
    };
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

// =============================================================================
// Entry helpers
// =============================================================================

function getEntry(serverId: string): ServerEntry {
    const existing = servers.get(serverId);
    // Schema-drift defence — a globalThis-cached entry from a PRIOR
    // dev-server generation may be missing fields that newer rounds
    // of the refactor added (refs/pendingClose on ConnectedClient,
    // connectHooks/phaseHistory on ServerEntry, ...). Reusing such
    // a half-initialised entry causes `refs++ → NaN`, `connectHooks.push
    // → TypeError`, etc. Detect via a sentinel field (`connectHooks`
    // is the youngest), and on mismatch drop the entry — its old
    // child process is unreachable already, treating it as a fresh
    // entry just means we'll re-spawn on next access. Production is
    // unaffected because `NODE_ENV === "production"` never persists
    // the Map across reloads (globalThis cache is dev-only).
    if (
        existing &&
        Array.isArray(existing.connectHooks) &&
        Array.isArray(existing.phaseHistory)
    ) {
        return existing;
    }
    const fresh: ServerEntry = {
        serverId,
        status: "idle",
        connected: null,
        error: null,
        connectPromise: null,
        connectHooks: [],
        phaseHistory: [],
    };
    servers.set(serverId, fresh);
    return fresh;
}

/** Snapshot of the public-facing view of a connected client. Mirrors
 *  the legacy `CachedClient` shape so protocol.ts / dispatch.ts can
 *  use the field names they already know, plus the explicit `release`
 *  callback that drives the runtime's refcount. */
interface ClientHandle {
    client: Client;
    builtFor: string;
    /** Must be called exactly once per successful `getClient`. After
     *  release, the `client` reference is invalid — using it may hit
     *  a closed transport when a config rebuild ran during the RPC. */
    release: () => void;
}

function handleFor(cc: ConnectedClient): ClientHandle {
    // One-shot release: calling release() twice is a no-op, not a
    // double-decrement. Without this guard, a finally-block running
    // twice (extremely unlikely in practice) OR a caller defensively
    // releasing in both then- and catch- arms would corrupt the
    // refcount, potentially triggering a premature close while
    // another caller is mid-RPC.
    let released = false;
    return {
        client: cc.client,
        builtFor: cc.builtFor,
        release: () => {
            if (released) return;
            released = true;
            release(cc);
        },
    };
}

// Sibling-module hooks. protocol.ts + dispatch.ts need the shared
// client cache + per-call timeout helpers — they live here because
// they're tied to lifecycle. Keep these out of the public surface
// (don't re-export from index.ts).
export { getClient, withTimeout, CALL_TIMEOUT_MS };

async function getClient(
    server: McpServerDTO,
    hooks?: BuildClientHooks,
    opts?: BuildClientOpts,
): Promise<ClientHandle> {
    // SIGTERM gate — once disposeAll fires, refuse to spawn anything new.
    // Without this, a request landing in the shutdown window (Next still
    // accepts in-flight + newly-arrived requests until the loop drains)
    // would spawn `npx`/`uvx` children, register them in spawningTransports
    // AFTER the snapshot was taken, and orphan them when the parent exits.
    if (shuttingDown) {
        throw new Error("MCP runtime is shutting down — refusing new spawn");
    }
    const e = getEntry(server.id);

    // 1. Reuse a healthy connection for the SAME config version.
    //    pendingClose is checked so a connection that's already been
    //    detached by softClose (and is just waiting on its last
    //    in-flight release) doesn't get picked up by a new caller.
    if (
        e.status === "connected" &&
        e.connected &&
        !e.connected.pendingClose &&
        e.connected.builtFor === server.config_version
    ) {
        const cc = acquire(e.connected);
        // Fire the "ready" phase synchronously so a re-check that
        // reuses an existing process still shows a state transition
        // in the UI (otherwise the log panel sits at "spawning…").
        hooks?.onPhase?.("ready");
        return handleFor(cc);
    }

    // 2. Join an in-flight build — including hook composition so SSE
    //    consumers that arrive after the spawn started still receive
    //    all subsequent phase + log events from the SAME spawning
    //    child. Replay phases that already fired so the joiner sees
    //    a coherent timeline.
    if (e.status === "connecting" && e.connectPromise) {
        if (hooks) {
            for (const phase of e.phaseHistory) hooks.onPhase?.(phase);
            e.connectHooks.push(hooks);
        }
        return e.connectPromise.then((cc) => handleFor(acquire(cc)));
    }

    // 3. Stale (config changed since last build) — softClose old so
    //    in-flight RPCs finish cleanly. New callers go through the
    //    fresh build below. Failed entries get reset.
    if (e.status === "connected" && e.connected) {
        softClose(e, e.connected);
    } else if (e.status === "failed") {
        e.error = null;
    }

    // 4. Refuse to spawn for a disabled server. Live DB read instead of
    //    `server.enabled` because the dto here may be a stale snapshot
    //    from a long-running runMcpCheck pipeline — between the snapshot
    //    and this line the admin could have disabled the row, and the
    //    only way to catch that is a fresh lookup. Without this gate, a
    //    `PATCH {enabled:false, config:{...}}` that races a re-enable
    //    check would leave us with a live child process for a row marked
    //    disabled in the DB.
    if (!isServerEnabledInDb(server.id)) {
        throw new Error(`MCP server "${server.name}" is disabled`);
    }

    // 5. Start a fresh connect under the singleflight contract.
    e.status = "connecting";
    e.error = null;
    e.connectHooks = hooks ? [hooks] : [];
    e.phaseHistory = [];

    const composedHooks: BuildClientHooks = {
        // Snapshot the subscriber list before fanning out so a hook
        // callback that joins another concurrent build (recursively
        // calling getClient) can't mutate the array we're iterating
        // — without this, a misbehaving subscriber could trigger
        // duplicate phase delivery or even an infinite loop.
        onPhase: (phase) => {
            e.phaseHistory.push(phase);
            const snapshot = e.connectHooks.slice();
            for (const h of snapshot) h.onPhase?.(phase);
        },
        onLog: (line) => {
            const snapshot = e.connectHooks.slice();
            for (const h of snapshot) h.onLog?.(line);
        },
        onUnexpectedClose: () => {
            // Only react if WE are still the live connection — a
            // delayed close from a previous session must not poison a
            // successor.
            if (e.connected && e.connected.session === sessionForThisBuild) {
                appendMcpLog(server.id, "lifecycle", "disconnected reason=transport_closed");
                const dead = e.connected;
                e.connected = null;
                e.status = "failed";
                e.error = "Transport closed unexpectedly";
                // Best-effort cleanup — process is already gone, but
                // there may still be listeners / fds to drop.
                dead.pendingClose = true;
                if (dead.refs <= 0) {
                    dead.close().catch(() => { /* ignore */ });
                }
            }
        },
    };
    // Captured lazily — buildClient assigns its session symbol via
    // the returned ConnectedClient, which we then snapshot here so
    // the unexpected-close handler can identify itself.
    let sessionForThisBuild: symbol | null = null;

    e.connectPromise = (async () => {
        try {
            const connected = await buildClient(server, composedHooks, opts);
            sessionForThisBuild = connected.session;
            evictLruIfFull();
            e.status = "connected";
            e.connected = connected;
            return connected;
        } catch (err) {
            e.status = "failed";
            e.error = err instanceof Error ? err.message : String(err);
            e.connected = null;
            throw err;
        } finally {
            e.connectPromise = null;
            e.connectHooks = [];
            e.phaseHistory = [];
        }
    })();

    return e.connectPromise.then((cc) => handleFor(acquire(cc)));
}

/** Bound the cache size by softClosing the least-recently-used
 *  connected entries whenever we're at or above the cap. Called before
 *  every admit so the cap is a hard ceiling regardless of access
 *  pattern. softClose is refcount-aware — entries currently servicing
 *  an RPC will finish first, then close. */
function evictLruIfFull(): void {
    const live = Array.from(servers.values()).filter(
        (e) => e.status === "connected" && e.connected && !e.connected.pendingClose,
    );
    if (live.length < MAX_ACTIVE_CLIENTS) return;
    live.sort((a, b) => a.connected!.lastUsed - b.connected!.lastUsed);
    const toEvict = live.slice(0, live.length - MAX_ACTIVE_CLIENTS + 1);
    for (const e of toEvict) {
        const cc = e.connected!;
        e.status = "idle";
        softClose(e, cc);
    }
}

// =============================================================================
// Public API
// =============================================================================

/** Force a fresh teardown of a server's connection. Called from CRUD
 *  delete so we don't keep a child process alive for a row that no
 *  longer exists, and from the admin-facing /stop and /restart paths.
 *  Safe to call against a server that's idle / failed / never connected.
 *
 *  In-flight RPCs on the cached connection are honoured — the actual
 *  transport.close fires after the last `release()`, OR after
 *  `waitForCloseMs` (default `CALL_TIMEOUT_MS`) whichever comes first.
 *  Callers that want a tighter ceiling (e.g. the /restart route, which
 *  needs to return before a reverse-proxy 504) pass a smaller budget;
 *  in-flight RPCs in that window get a "Connection closed" error which
 *  is acceptable because the caller is explicitly asking to tear down.
 *  Concurrent disposes are idempotent (the second one finds no entry /
 *  no connected).
 *
 *  IMPORTANT: this function does NOT remove the entry from `servers`.
 *  Doing so opens a race where a concurrent `getClient` (chat dispatch
 *  arriving mid-dispose, or a re-enable's scheduleCheck) latches a new
 *  build onto the SAME entry between waitForClose returning and
 *  servers.delete running — the new ConnectedClient ends up unreachable,
 *  leaking the child process. Leaving the entry in `idle` state lets
 *  the concurrent build mutate a still-tracked entry, so any future
 *  dispose / eviction / shutdown can find it. Use `forgetMcpServer`
 *  to evict the entry permanently when the underlying row is deleted. */
export async function disposeMcpClient(
    serverId: string,
    opts: { waitForCloseMs?: number } = {},
): Promise<void> {
    const e = servers.get(serverId);
    if (!e) {
        // No entry, but the log file may still exist (a prior process
        // wrote it and we restarted). Close any orphaned writer fd.
        closeMcpLogWriter(serverId);
        return;
    }

    // Wait for any in-flight connect to settle so we don't leave an
    // orphaned process behind. Swallow the error — we're tearing
    // down regardless.
    if (e.connectPromise) {
        try { await e.connectPromise; } catch { /* ignore */ }
    }

    const cc = e.connected;
    e.connected = null;
    e.status = "idle";
    e.error = null;
    if (cc) {
        softClose(e, cc);
        appendMcpLog(serverId, "lifecycle", "disconnected reason=disposed");
        // Drain the refcount so the close actually fires before we
        // return. softClose is fire-and-forget by design, but the
        // dispose API's contract is "by the time I return, no new
        // callers will reach this connection AND the child process
        // is gone" — so we await the in-flight RPCs (bounded by
        // `waitForCloseMs`) and then force-close. The force-close is
        // critical: without it, a wedged RPC would leave the child
        // process alive indefinitely (refs never reach 0 → release
        // never fires close), defeating the whole point of dispose.
        // Active RPCs may see "Connection closed" — that's better
        // than a zombie child.
        const waitMs = opts.waitForCloseMs ?? CALL_TIMEOUT_MS;
        await waitForClose(cc, waitMs).catch(() => { /* ignore */ });
        if (cc.refs > 0) {
            // Wedged RPC — force teardown. Any release()'s subsequent
            // call to cc.close() will no-op because of cc.closed
            // (idempotency latch) — see release().
            try { await cc.close(); } catch { /* ignore */ }
        }
    }
    closeMcpLogWriter(serverId);
    // Entry deliberately NOT deleted — see header comment.
}

/** Permanently remove a server's runtime entry. Called from
 *  `deleteMcpServer` after `disposeMcpClient` settles, when the DB
 *  row itself is gone for good. Future getClient for this id will
 *  build a fresh entry via getEntry — but it'll trip
 *  `isServerEnabledInDb` (row not found → false) and throw, so no
 *  spawn happens.
 *
 *  Separate from `disposeMcpClient` because for stop/restart/disable
 *  flows the row still exists and we WANT the entry to stay (so the
 *  next call rebuilds against the live config). Only deletion warrants
 *  a hard forget. */
export function forgetMcpServer(serverId: string): void {
    servers.delete(serverId);
}

/** Resolves when `cc.close` has fired (refs==0 and pendingClose) or
 *  the deadline passes, whichever comes first. Polled — refs are
 *  decremented sync from release() so a 50 ms interval is plenty. */
async function waitForClose(cc: ConnectedClient, deadlineMs: number): Promise<void> {
    const start = Date.now();
    while (cc.refs > 0 && Date.now() - start < deadlineMs) {
        await new Promise((r) => setTimeout(r, 50));
    }
    // The close fires from release() once refs hit 0 — give it a
    // short tick to settle.
    await new Promise((r) => setTimeout(r, 10));
}

/** Runtime status snapshot — what the admin UI shows in the live
 *  panel. Distinguishes the four state-machine statuses from a row
 *  that has never been accessed (no entry at all). */
export interface McpRuntimeStatus {
    serverId: string;
    status: Status;
    pid: number | null;
    startedAt: string | null;
    builtFor: string | null;
    error: string | null;
}

export function getMcpRuntimeStatus(serverId: string): McpRuntimeStatus {
    const e = servers.get(serverId);
    if (!e) {
        return {
            serverId,
            status: "idle",
            pid: null,
            startedAt: null,
            builtFor: null,
            error: null,
        };
    }
    return {
        serverId,
        status: e.status,
        pid: e.connected?.pid ?? null,
        startedAt: e.connected?.startedAt ?? null,
        builtFor: e.connected?.builtFor ?? null,
        error: e.error,
    };
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
    const e = servers.get(serverId);
    if (!e || e.status !== "connected" || !e.connected) return null;
    const c = e.connected.client;
    const ver = c.getServerVersion();
    const instructions = c.getInstructions();
    const capabilities = c.getServerCapabilities() as Record<string, unknown> | undefined;
    if (!ver && !instructions && !capabilities) return null;
    return {
        name: ver?.name,
        version: ver?.version,
        instructions,
        capabilities,
    };
}
