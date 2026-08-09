// Reusable fake replacements for the `@modelcontextprotocol/sdk` client-side
// pieces that `lib/server/mcp/runtime.ts` imports:
//
//   import { Client } from "@modelcontextprotocol/sdk/client/index.js";
//   import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
//   import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
//
// Tests that exercise the real runtime.ts (and protocol.ts, which calls
// straight into runtime.getClient) mock those three module specifiers with
// the classes below, e.g.:
//
//   vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: FakeMcpClient }));
//   vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: FakeStdioTransport }));
//   vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: FakeHttpTransport }));
//
// No real process is ever spawned and no real socket ever opens — every
// method here is a plain in-memory stand-in.
//
// ---- timing contract (read this before scripting a test) ----
//
// runtime.ts's `buildClient` constructs `new Client(...)` and (for stdio)
// `new StdioClientTransport(...)` SYNCHRONOUSLS, before its first `await`.
// Concretely: calling (but not awaiting) `getClient(dto, hooks, opts)`
// synchronously reaches `client.connect(transport)` before yielding control
// back to the caller. That means by the time your test's call to
// `getClient(...)` returns (still without an `await`), the relevant
// `FakeMcpClient` / `FakeStdioTransport` / `FakeHttpTransport` instance has
// already been constructed and IS available via `<Class>.instances.at(-1)`.
//
// To script a connect's outcome you therefore have two options:
//
//   1. Set `FakeMcpClient.nextScript` BEFORE calling the code under test —
//      the next constructed instance consumes (and clears) it. Good for
//      "just resolve" / "just reject" / "resolve after N ms" cases.
//   2. Use `{ connect: { mode: "manual" } }` and grab the instance via
//      `FakeMcpClient.instances.at(-1)!` right after the (unawaited) call
//      that constructs it, then call `.resolveConnect()` / `.rejectConnect(err)`
//      whenever your test wants the handshake to complete. This is what you
//      want for "hangs forever" (never call either — pair with fake timers)
//      and "join an in-flight build" tests (resolve only after asserting a
//      second caller joined).

import { PassThrough } from "node:stream";

// =============================================================================
// Fake Client (@modelcontextprotocol/sdk/client/index.js)
// =============================================================================

export interface ConnectScript {
    /** "auto" (default): settles on its own — resolves, or rejects with
     *  `error` if set, after `delayMs` (default: next microtask).
     *  "manual": the test drives it via `resolveConnect()` / `rejectConnect()`.
     *  Never calling either simulates a connect that hangs forever — pair
     *  with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` to
     *  exercise runtime.ts's `withTimeout` timeout branch. */
    mode?: "auto" | "manual";
    delayMs?: number;
    /** `unknown` on purpose: tests script non-Error rejections to exercise
     *  the `String(err)` fallback in runtime.ts. */
    error?: unknown;
}

export interface FakeClientScript {
    connect?: ConnectScript;
    /** Negotiated capabilities map — e.g. `{ tools: {}, resources: {}, prompts: {} }`.
     *  Omit `resources` / `prompts` to simulate a server that doesn't
     *  advertise that capability (protocol.ts gates its list calls on this). */
    capabilities?: Record<string, unknown>;
    serverInfo?: { name?: string; version?: string };
    instructions?: string;
    toolsResult?: unknown;
    toolsError?: Error;
    resourcesResult?: unknown;
    resourcesError?: Error;
    resourceTemplatesResult?: unknown;
    resourceTemplatesError?: Error;
    promptsResult?: unknown;
    promptsError?: Error;
    /** Overrides the default `{content:[{type:"text",text:"ok"}],isError:false}`
     *  reply. Throw synchronously (or return a rejecting promise) to
     *  simulate an RPC-level failure. */
    callToolImpl?: (params: { name: string; arguments: Record<string, unknown> }) => unknown;
}

function defaultScript(): FakeClientScript {
    return {
        connect: { mode: "auto" },
        capabilities: {},
        toolsResult: { tools: [] },
        resourcesResult: { resources: [] },
        resourceTemplatesResult: { resourceTemplates: [] },
        promptsResult: { prompts: [] },
    };
}

export class FakeMcpClient {
    static instances: FakeMcpClient[] = [];
    /** Consumed (and cleared) by the NEXT constructed instance. */
    static nextScript: FakeClientScript | null = null;

    script: FakeClientScript;
    transport: { onclose?: () => void } | null = null;
    calledTools: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    resolveConnect: (() => void) | null = null;
    rejectConnect: ((err: unknown) => void) | null = null;
    /** Call counters — lets a test assert a capability-gated method was
     *  (or crucially, was NOT) invoked, without needing to spy after the
     *  instance already exists mid-call. */
    listToolsCalls = 0;
    listResourcesCalls = 0;
    listResourceTemplatesCalls = 0;
    listPromptsCalls = 0;

    constructor(
        public clientInfo: unknown,
        public options: unknown,
    ) {
        this.script = { ...defaultScript(), ...(FakeMcpClient.nextScript ?? {}) };
        FakeMcpClient.nextScript = null;
        FakeMcpClient.instances.push(this);
    }

    connect(transport: { onclose?: () => void }): Promise<void> {
        this.transport = transport;
        // Mirror the real SDK's Protocol.connect(): CHAIN the transport's
        // existing onclose rather than clobbering it (shared/protocol.js
        // does `const _onclose = transport.onclose; transport.onclose = ()
        // => { _onclose?.(); this._onclose(); }`). runtime.ts's own
        // `attachUnexpectedClose` relies on this chain-not-clobber contract
        // (it attaches BEFORE connect so it must not get wiped out here).
        const prevOnClose = transport.onclose;
        transport.onclose = () => {
            prevOnClose?.();
        };

        return new Promise<void>((resolve, reject) => {
            this.resolveConnect = resolve;
            this.rejectConnect = reject;
            const c = this.script.connect ?? { mode: "auto" };
            if (c.mode === "manual") return;
            const fire = () => {
                if (c.error) reject(c.error);
                else resolve();
            };
            if (c.delayMs) setTimeout(fire, c.delayMs);
            else queueMicrotask(fire);
        });
    }

    getServerCapabilities(): Record<string, unknown> | undefined {
        return this.script.capabilities;
    }

    getServerVersion(): { name?: string; version?: string } | undefined {
        return this.script.serverInfo;
    }

    getInstructions(): string | undefined {
        return this.script.instructions;
    }

    async listTools(): Promise<unknown> {
        this.listToolsCalls++;
        if (this.script.toolsError) throw this.script.toolsError;
        return this.script.toolsResult;
    }

    async listResources(): Promise<unknown> {
        this.listResourcesCalls++;
        if (this.script.resourcesError) throw this.script.resourcesError;
        return this.script.resourcesResult;
    }

    async listResourceTemplates(): Promise<unknown> {
        this.listResourceTemplatesCalls++;
        if (this.script.resourceTemplatesError) throw this.script.resourceTemplatesError;
        return this.script.resourceTemplatesResult;
    }

    async listPrompts(): Promise<unknown> {
        this.listPromptsCalls++;
        if (this.script.promptsError) throw this.script.promptsError;
        return this.script.promptsResult;
    }

    async callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown> {
        this.calledTools.push(params);
        if (this.script.callToolImpl) return this.script.callToolImpl(params);
        return { content: [{ type: "text", text: "ok" }], isError: false };
    }
}

// =============================================================================
// Fake stdio transport (@modelcontextprotocol/sdk/client/stdio.js)
// =============================================================================

export interface FakeStdioScript {
    pid?: number | null;
    /** Defaults to mirroring the caller's `stderr: "pipe"` param. Force
     *  `false` to simulate a transport that doesn't expose a stderr stream. */
    withStderr?: boolean;
    /** If set, `close()` rejects with this error instead of resolving —
     *  simulates a transport whose OS-level teardown itself fails
     *  (e.g. an already-dead child). Used to exercise disposeAll's
     *  `.catch(() => undefined)` guard on the raw (unwrapped) transport
     *  handle it force-closes for still-connecting spawns. */
    closeError?: Error;
}

export interface FakeStdioParams {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    stderr?: string;
}

export class FakeStdioTransport {
    static instances: FakeStdioTransport[] = [];
    static nextScript: FakeStdioScript | null = null;
    static nextPid = 1000;

    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: unknown) => void;
    closeCalls = 0;
    private _stderr: PassThrough | null;
    private _pid: number | null;
    private _closeError?: Error;

    constructor(params: FakeStdioParams) {
        this.command = params.command;
        this.args = params.args ?? [];
        this.env = params.env;
        this.cwd = params.cwd;
        const script = FakeStdioTransport.nextScript;
        FakeStdioTransport.nextScript = null;
        const withStderr = script?.withStderr ?? params.stderr === "pipe";
        this._stderr = withStderr ? new PassThrough() : null;
        this._pid = script && "pid" in script ? (script.pid ?? null) : FakeStdioTransport.nextPid++;
        this._closeError = script?.closeError;
        FakeStdioTransport.instances.push(this);
    }

    get stderr(): PassThrough | null {
        return this._stderr;
    }

    get pid(): number | null {
        return this._pid;
    }

    /** Admin-initiated / graceful close — mirrors the real transport: closing
     *  the child process fires the process's `close` event, which fires
     *  `onclose()`. Tracked separately from `crash()` so assertions on
     *  "closed N times" stay meaningful. */
    async close(): Promise<void> {
        this.closeCalls++;
        if (this._closeError) throw this._closeError;
        this.onclose?.();
    }

    /** Simulate the child dying on its own (crash, kill -9 from outside,
     *  OOM) WITHOUT going through our `close()` accounting — exactly what
     *  runtime.ts's `onUnexpectedClose` hook exists to detect. */
    crash(): void {
        this.onclose?.();
    }

    async send(_message: unknown): Promise<void> {}
}

// =============================================================================
// Fake HTTP transport (@modelcontextprotocol/sdk/client/streamableHttp.js)
// =============================================================================

export interface FakeHttpParams {
    requestInit?: { headers?: Record<string, string> };
}

export class FakeHttpTransport {
    static instances: FakeHttpTransport[] = [];
    /** Consumed (and cleared) by the NEXT constructed instance — mirrors
     *  `FakeStdioTransport.nextScript.closeError`. */
    static nextCloseError: Error | null = null;

    url: URL;
    requestInit: { headers?: Record<string, string> } | undefined;
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: unknown) => void;
    closeCalls = 0;
    private _closeError: Error | null;

    constructor(url: URL, opts?: FakeHttpParams) {
        this.url = url;
        this.requestInit = opts?.requestInit;
        this._closeError = FakeHttpTransport.nextCloseError;
        FakeHttpTransport.nextCloseError = null;
        FakeHttpTransport.instances.push(this);
    }

    async close(): Promise<void> {
        this.closeCalls++;
        if (this._closeError) throw this._closeError;
        this.onclose?.();
    }

    crash(): void {
        this.onclose?.();
    }

    async send(_message: unknown): Promise<void> {}
}

/** Reset ALL fake-mcp state. Call from `beforeEach`/`afterEach` in every
 *  test file that uses these fakes so scripted behaviour and captured
 *  instances never leak between tests. */
export function resetFakeMcp(): void {
    FakeMcpClient.instances = [];
    FakeMcpClient.nextScript = null;
    FakeStdioTransport.instances = [];
    FakeStdioTransport.nextScript = null;
    FakeStdioTransport.nextPid = 1000;
    FakeHttpTransport.instances = [];
    FakeHttpTransport.nextCloseError = null;
}
