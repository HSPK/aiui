// Dedicated, ISOLATED test file for runtime.ts's process-exit cleanup
// (`disposeAll`, registered against SIGINT/SIGTERM/beforeExit).
//
// Why a separate file instead of folding this into runtime.test.ts:
// `disposeAll` is not exported, sets a permanent module-level
// `shuttingDown = true` latch with no reset hook, and — once tripped —
// makes every subsequent `getClient()` call in the SAME module instance
// throw "MCP runtime is shutting down". Vitest gives each test FILE its
// own fresh module graph (a separate worker process under the default
// "forks" pool), so confining this to its own file guarantees it can
// never poison `runtime.test.ts`'s 46 other tests regardless of run
// order or future edits to either file.
//
// `process.emit("beforeExit", 0)` is a plain EventEmitter call — it
// invokes whatever listener(s) are registered on `process` for that
// event name. It does NOT send a real OS signal, does NOT terminate
// the process, and has no effect beyond synchronously running those
// callbacks — the same mechanism countless Node codebases use to unit
// test graceful-shutdown hooks without touching the OS. We use
// `beforeExit` specifically (rather than SIGINT/SIGTERM) because it
// carries no OS-level "please terminate" semantics at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedMcpServer } from "../../helpers/db";
import { FakeHttpTransport, FakeMcpClient, FakeStdioTransport, resetFakeMcp } from "./_fake-mcp";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: FakeMcpClient }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: FakeStdioTransport }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: FakeHttpTransport }));
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => {
        throw new Error("real node:child_process.spawn must never be called under test");
    }),
}));

import { getClient } from "@/lib/server/mcp/runtime";
import { getMcpServer } from "@/lib/server/mcp/service";

const realFetch = global.fetch;

function stdioServer(overrides: Parameters<typeof seedMcpServer>[0] = {}) {
    return seedMcpServer({
        transport: "stdio",
        config: { command: "npx", args: ["-y", "thing"] },
        enabled: true,
        ...overrides,
    });
}

function httpServer(overrides: Parameters<typeof seedMcpServer>[0] = {}) {
    return seedMcpServer({
        transport: "http",
        config: { url: "https://mcp.example.com/mcp" },
        enabled: true,
        ...overrides,
    });
}

beforeEach(() => {
    resetDb();
    resetFakeMcp();
    global.fetch = vi.fn(async () => {
        throw new Error("real fetch must never be called under test");
    }) as unknown as typeof fetch;
});

afterEach(() => {
    vi.useRealTimers();
    global.fetch = realFetch;
});

describe("process-exit cleanup (disposeAll via beforeExit) — isolated, mutates permanent shutdown state", () => {
    it("force-closes connected AND still-spawning transports, then gates future getClient calls", async () => {
        expect(process.listenerCount("beforeExit")).toBeGreaterThan(0);

        vi.useFakeTimers();

        // 1. A fully-connected stdio client — exercises disposeAll's
        //    `entries` loop (force-close regardless of refcount).
        const connectedSeed = stdioServer();
        const connectedHandle = await getClient(getMcpServer(connectedSeed.id));
        const connectedTransport = FakeStdioTransport.instances.at(-1)!;

        // 2. A stdio connect that never settles on its own — still
        //    "spawning" (pre-handshake) when shutdown fires. Scripted to
        //    reject on close() so we also cover disposeAll's raw
        //    `t.close().catch(() => undefined)` guard.
        const stuckStdioSeed = stdioServer();
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        FakeStdioTransport.nextScript = { closeError: new Error("already dead") };
        const stuckStdioPromise = getClient(getMcpServer(stuckStdioSeed.id));
        const stuckStdioTransport = FakeStdioTransport.instances.at(-1)!;

        // 3. Same shape for HTTP, so both transport kinds' `spawningHandle.close`
        //    get exercised by the same test.
        const stuckHttpSeed = httpServer();
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        FakeHttpTransport.nextCloseError = new Error("already dead");
        const stuckHttpPromise = getClient(getMcpServer(stuckHttpSeed.id));
        const stuckHttpTransport = FakeHttpTransport.instances.at(-1)!;

        // Swallow eventual settlement — these never resolve/reject on
        // their own (manual connect mode); once `withTimeout`'s own
        // (fake-timer-driven) deadline eventually elapses they'll
        // reject, which would otherwise surface as an unhandled
        // rejection once the fake clock is torn down at file end.
        stuckStdioPromise.catch(() => { /* expected: never resolves in this test */ });
        stuckHttpPromise.catch(() => { /* expected: never resolves in this test */ });

        // Let the manual connects' synchronous prefix (spawningTransports.add,
        // etc.) run to completion before shutdown fires.
        await vi.advanceTimersByTimeAsync(0);

        process.emit("beforeExit", 0);

        // disposeAll's internal `Promise.all` awaits each close(); those
        // are plain microtask-resolving fakes, but flush via the fake
        // timer driver so nothing is left mid-flight.
        await vi.advanceTimersByTimeAsync(0);

        expect(connectedTransport.closeCalls).toBe(1);
        expect(stuckStdioTransport.closeCalls).toBe(1);
        expect(stuckHttpTransport.closeCalls).toBe(1);

        // Idempotency: SIGINT/SIGTERM/beforeExit all `.once()`-register the
        // SAME handler, so a second real-world signal arriving in quick
        // succession (e.g. an orchestrator escalating SIGTERM -> SIGKILL,
        // racing Node's own `beforeExit`) must not attempt a second round
        // of closes against transports we already tore down.
        process.emit("SIGTERM");
        await vi.advanceTimersByTimeAsync(0);
        expect(connectedTransport.closeCalls).toBe(1);
        expect(stuckStdioTransport.closeCalls).toBe(1);
        expect(stuckHttpTransport.closeCalls).toBe(1);

        // The shutdown gate: once disposeAll has fired, getClient must
        // refuse ANY new spawn rather than orphaning a child that
        // outlives the parent's shutdown sequence.
        const anotherSeed = stdioServer();
        await expect(getClient(getMcpServer(anotherSeed.id))).rejects.toThrow(/shutting down/i);

        connectedHandle.release();
    });
});
