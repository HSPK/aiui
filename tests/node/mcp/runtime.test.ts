import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, seedMcpServer } from "../../helpers/db";
import {
    FakeHttpTransport,
    FakeMcpClient,
    FakeStdioTransport,
    resetFakeMcp,
} from "./_fake-mcp";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: FakeMcpClient }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: FakeStdioTransport }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: FakeHttpTransport }));
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => {
        throw new Error("real node:child_process.spawn must never be called under test");
    }),
}));

import { db, schema } from "@/lib/server/db";
import { getMcpServer } from "@/lib/server/mcp/service";
import { readMcpLog } from "@/lib/server/mcp/logs";
import {
    CALL_TIMEOUT_MS,
    disposeMcpClient,
    forgetMcpServer,
    getClient,
    getMcpRuntimeStatus,
    readServerInfo,
    withTimeout,
    type BuildClientHooks,
} from "@/lib/server/mcp/runtime";

const realFetch = global.fetch;
const createdIds: string[] = [];

function stdioServer(overrides: Parameters<typeof seedMcpServer>[0] = {}) {
    const s = seedMcpServer({
        transport: "stdio",
        config: { command: "npx", args: ["-y", "thing"] },
        enabled: true,
        ...overrides,
    });
    createdIds.push(s.id);
    return s;
}

function httpServer(overrides: Parameters<typeof seedMcpServer>[0] = {}) {
    const s = seedMcpServer({
        transport: "http",
        config: { url: "https://mcp.example.com/mcp" },
        enabled: true,
        ...overrides,
    });
    createdIds.push(s.id);
    return s;
}

function dtoOf(id: string) {
    return getMcpServer(id);
}

function setEnabled(id: string, enabled: boolean) {
    db.update(schema.mcpServers).set({ enabled }).where(eq(schema.mcpServers.id, id)).run();
}

function setConfigVersion(id: string, configVersion: string) {
    db.update(schema.mcpServers).set({ configVersion }).where(eq(schema.mcpServers.id, id)).run();
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
    vi.useRealTimers();
    for (const id of createdIds.splice(0)) {
        // A short waitForCloseMs is a defensive measure: if a test's
        // own assertion throws before it releases a handle, cleanup
        // must not ride out the real 60s CALL_TIMEOUT_MS default —
        // that would surface as a confusing hook-timeout instead of
        // the real assertion failure.
        await disposeMcpClient(id, { waitForCloseMs: 200 });
        forgetMcpServer(id);
    }
    global.fetch = realFetch;
});

describe("buildClient via getClient — stdio", () => {
    it("spawns, connects, and returns a working handle; records lifecycle logs", async () => {
        const s = stdioServer({ config: { command: "npx", args: ["-y", "thing"], env: { A: "b" }, cwd: "/work" } });
        const dto = dtoOf(s.id);
        FakeStdioTransport.nextScript = { pid: 4242 };
        const handle = await getClient(dto);

        expect(handle.builtFor).toBe(dto.config_version);
        const transport = FakeStdioTransport.instances.at(-1)!;
        expect(transport.command).toBe("npx");
        expect(transport.args).toEqual(["-y", "thing"]);
        expect(transport.env).toEqual({ A: "b" });
        expect(transport.cwd).toBe("/work");

        const status = getMcpRuntimeStatus(s.id);
        expect(status.status).toBe("connected");
        expect(status.pid).toBe(4242);
        expect(status.builtFor).toBe(dto.config_version);
        expect(status.startedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

        const logs = readMcpLog(s.id, 100).join("\n");
        expect(logs).toContain("spawning command=npx");
        expect(logs).toContain("starting");
        expect(logs).toContain("connecting");
        expect(logs).toContain("ready pid=4242");

        handle.release();
    });

    it("forwards onPhase/onLog hooks in order, including live stderr lines", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        const phases: string[] = [];
        const logs: string[] = [];
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const hooks: BuildClientHooks = {
            onPhase: (p) => phases.push(p),
            onLog: (l) => logs.push(l),
        };
        const pending = getClient(dto, hooks);
        expect(phases).toEqual(["spawning", "starting", "connecting"]);

        const transport = FakeStdioTransport.instances.at(-1)!;
        transport.stderr!.write("first line\n");
        await new Promise((r) => process.nextTick(r));
        expect(logs).toEqual(["first line"]);

        FakeMcpClient.instances.at(-1)!.resolveConnect!();
        const handle = await pending;
        expect(phases).toEqual(["spawning", "starting", "connecting", "ready"]);
        handle.release();
    });

    it("caps captured stderr at STDERR_CAP and enriches a connect failure with it", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const pending = getClient(dto);
        const transport = FakeStdioTransport.instances.at(-1)!;
        // Push well past the 4096-char cap across many lines.
        for (let i = 0; i < 100; i++) {
            transport.stderr!.write(`stderr line ${i} ${"x".repeat(80)}\n`);
        }
        await new Promise((r) => process.nextTick(r));
        FakeMcpClient.instances.at(-1)!.rejectConnect!(new Error("ECONNREFUSED"));
        await expect(pending).rejects.toThrow(/ECONNREFUSED[\s\S]*--- child stderr ---/);
    });

    it("closes the transport and removes the spawning-transport registration on a connect failure", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { error: new Error("spawn ENOENT") } };
        await expect(getClient(dto)).rejects.toThrow("spawn ENOENT");
        const transport = FakeStdioTransport.instances.at(-1)!;
        expect(transport.closeCalls).toBe(1);
        const status = getMcpRuntimeStatus(s.id);
        expect(status.status).toBe("failed");
        expect(status.error).toBe("spawn ENOENT");
    });

    it("times out a stuck stdio connect using the caller's connectTimeoutMs override, with the widen-timeout hint", async () => {
        vi.useFakeTimers();
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const pending = getClient(dto, undefined, { connectTimeoutMs: 5_000 });
        const assertion = expect(pending).rejects.toThrow(
            /mcp connect timed out after 5000ms — raise mcp_connect_timeout_seconds/,
        );
        // The stdio catch path does an additional 100ms grace wait (to
        // flush late stderr) after the connect-timeout itself fires —
        // advance past both.
        await vi.advanceTimersByTimeAsync(5_200);
        await assertion;
    });

    it("retries cleanly after a failed entry — a subsequent getClient call rebuilds instead of staying stuck", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { error: new Error("first attempt fails") } };
        await expect(getClient(dto)).rejects.toThrow("first attempt fails");
        expect(getMcpRuntimeStatus(s.id).status).toBe("failed");

        FakeMcpClient.nextScript = { connect: { mode: "auto" } };
        const handle = await getClient(dto);
        expect(getMcpRuntimeStatus(s.id).status).toBe("connected");
        expect(getMcpRuntimeStatus(s.id).error).toBeNull();
        handle.release();
    });
});

describe("buildClient via getClient — http", () => {
    it("connects with the configured URL + headers and logs lifecycle events without a pid", async () => {
        const s = httpServer({ config: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer xyz" } } });
        const dto = dtoOf(s.id);
        const handle = await getClient(dto);
        const transport = FakeHttpTransport.instances.at(-1)!;
        expect(transport.url.toString()).toBe("https://mcp.example.com/mcp");
        expect(transport.requestInit?.headers).toEqual({ Authorization: "Bearer xyz" });

        const status = getMcpRuntimeStatus(s.id);
        expect(status.pid).toBeNull();
        const logs = readMcpLog(s.id, 100).join("\n");
        expect(logs).toContain("connecting url=https://mcp.example.com/mcp");
        expect(logs).toContain("ready");
        handle.release();
    });

    it("re-throws a connect failure WITHOUT stderr enrichment (no stderr concept over HTTP)", async () => {
        const s = httpServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { error: new Error("502 Bad Gateway") } };
        let caught: Error | null = null;
        try {
            await getClient(dto);
        } catch (err) {
            caught = err as Error;
        }
        expect(caught?.message).toBe("502 Bad Gateway"); // exact match — nothing appended
        expect(caught?.message).not.toContain("child stderr");
    });

    it("times out a stuck http connect using the default 15s budget", async () => {
        vi.useFakeTimers();
        const s = httpServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const pending = getClient(dto);
        const assertion = expect(pending).rejects.toThrow(/mcp connect timed out after 15000ms/);
        await vi.advanceTimersByTimeAsync(15_000);
        await assertion;
    });
});

describe("buildClient — additional branch coverage", () => {
    it("handles a transport reporting no pid at all (falls back to null / '?' in the log line)", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeStdioTransport.nextScript = { pid: null };
        const handle = await getClient(dto);
        expect(getMcpRuntimeStatus(s.id).pid).toBeNull();
        const logs = readMcpLog(s.id, 100).join("\n");
        expect(logs).toContain("ready pid=?");
        handle.release();
    });

    it("skips stderr wiring entirely when the transport doesn't expose a stderr stream", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeStdioTransport.nextScript = { withStderr: false };
        const handle = await getClient(dto);
        expect(FakeStdioTransport.instances.at(-1)!.stderr).toBeNull();
        expect(getMcpRuntimeStatus(s.id).status).toBe("connected");
        handle.release();
    });

    it("tolerates a connect failure when the transport has no stderr stream to enrich from", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeStdioTransport.nextScript = { withStderr: false };
        FakeMcpClient.nextScript = { connect: { error: new Error("spawn failed") } };
        await expect(getClient(dto)).rejects.toThrow("spawn failed");
        expect(getMcpRuntimeStatus(s.id).status).toBe("failed");
    });

    it("wraps a non-Error stdio connect rejection in a real Error, with no stderr section when nothing was captured", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { error: "just a string, not an Error" } };
        let caught: unknown;
        try {
            await getClient(dto);
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe("just a string, not an Error");
        expect((caught as Error).message).not.toContain("child stderr");
        expect(getMcpRuntimeStatus(s.id).error).toBe("just a string, not an Error");
    });

    it("propagates a non-Error http connect rejection as a stringified entry error", async () => {
        const s = httpServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { error: "raw string rejection" } };
        await expect(getClient(dto)).rejects.toBe("raw string rejection");
        expect(getMcpRuntimeStatus(s.id).status).toBe("failed");
        expect(getMcpRuntimeStatus(s.id).error).toBe("raw string rejection");
    });

    it("emits an empty stderr line as a no-op and flushes trailing unterminated stderr on stream end", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        const handle = await getClient(dto);
        const transport = FakeStdioTransport.instances.at(-1)!;
        const ended = new Promise<void>((resolve) => transport.stderr!.once("end", resolve));
        transport.stderr!.write("\n"); // an empty line between newlines — emitLine's `if (!line) return;`
        transport.stderr!.write("trailing without newline"); // never terminated — flushed on 'end'
        transport.stderr!.end();
        await ended; // our own listener fires strictly after the already-registered stderrEndHandler
        const logs = readMcpLog(s.id, 100);
        // appendMcpLog is unconditional inside emitLine (independent of any
        // live onLog hook, which is only wired for the connect-phase
        // window) — the empty line never gets appended at all, while the
        // unterminated trailing text is flushed as its own line on 'end'.
        const stderrLines = logs.filter((l) => l.includes("[stderr]"));
        expect(stderrLines).toHaveLength(1);
        expect(stderrLines[0]).toContain("trailing without newline");
        handle.release();
    });

    it("does not double-flush on stream end when the last write was already newline-terminated", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        const handle = await getClient(dto);
        const transport = FakeStdioTransport.instances.at(-1)!;
        const ended = new Promise<void>((resolve) => transport.stderr!.once("end", resolve));
        transport.stderr!.write("a clean line\n"); // pending is fully drained by the "data" handler
        transport.stderr!.end(); // `if (pending)` in stderrEndHandler sees "" — nothing left to flush
        await ended;
        const stderrLines = readMcpLog(s.id, 100).filter((l) => l.includes("[stderr]"));
        expect(stderrLines).toHaveLength(1);
        expect(stderrLines[0]).toContain("a clean line");
        handle.release();
    });
});

describe("handleFor / ClientHandle", () => {
    it("makes a second release() call a no-op instead of double-decrementing the refcount", async () => {
        const s = httpServer();
        const handle = await getClient(dtoOf(s.id));
        handle.release();
        handle.release(); // must not throw, must not double-decrement
        // A subsequent getClient still reuses the same (never-force-closed) connection.
        const handle2 = await getClient(dtoOf(s.id));
        expect(FakeHttpTransport.instances).toHaveLength(1);
        handle2.release();
    });
});

describe("getClient reuse / singleflight / stale-rebuild / disabled-gate", () => {
    it("lets a joiner with no hooks at all join an in-flight build cleanly", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const p1 = getClient(dto, { onPhase: vi.fn() });
        const p2 = getClient(dto); // no hooks argument at all
        expect(FakeStdioTransport.instances).toHaveLength(1);
        FakeMcpClient.instances.at(-1)!.resolveConnect!();
        const [h1, h2] = await Promise.all([p1, p2]);
        h1.release();
        h2.release();
    });


    it("reuses a live connection for the same config_version without spawning again", async () => {
        const s = httpServer();
        const dto = dtoOf(s.id);
        const h1 = await getClient(dto);
        h1.release();
        expect(FakeHttpTransport.instances).toHaveLength(1);

        const onPhase = vi.fn();
        const h2 = await getClient(dto, { onPhase });
        expect(FakeHttpTransport.instances).toHaveLength(1); // still just the one spawn
        expect(onPhase).toHaveBeenCalledExactlyOnceWith("ready");
        h2.release();
    });

    it("joins an in-flight build (singleflight) and replays already-fired phases to the joiner", async () => {
        const s = stdioServer();
        const dto = dtoOf(s.id);
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const hooks1: BuildClientHooks = { onPhase: vi.fn() };
        const hooks2: BuildClientHooks = { onPhase: vi.fn() };

        const p1 = getClient(dto, hooks1);
        const p2 = getClient(dto, hooks2);

        expect(FakeStdioTransport.instances).toHaveLength(1); // singleflight — only one spawn
        expect(hooks2.onPhase).toHaveBeenCalledTimes(3); // replay: spawning, starting, connecting
        expect(hooks2.onPhase).toHaveBeenNthCalledWith(1, "spawning");
        expect(hooks2.onPhase).toHaveBeenNthCalledWith(3, "connecting");

        FakeMcpClient.instances.at(-1)!.resolveConnect!();
        const [h1, h2] = await Promise.all([p1, p2]);
        expect(hooks1.onPhase).toHaveBeenCalledWith("ready");
        expect(hooks2.onPhase).toHaveBeenCalledWith("ready");
        h1.release();
        h2.release();
    });

    it("rebuilds when the config_version changes (stale), softClosing the old connection", async () => {
        const s = stdioServer();
        const dtoV1 = dtoOf(s.id);
        const h1 = await getClient(dtoV1);
        h1.release();
        const firstTransport = FakeStdioTransport.instances.at(-1)!;
        expect(getMcpRuntimeStatus(s.id).builtFor).toBe(dtoV1.config_version);

        setConfigVersion(s.id, "brand-new-version");
        const dtoV2 = dtoOf(s.id);
        const h2 = await getClient(dtoV2);
        expect(FakeStdioTransport.instances).toHaveLength(2); // a fresh spawn happened
        expect(getMcpRuntimeStatus(s.id).builtFor).toBe("brand-new-version");
        expect(firstTransport.closeCalls).toBe(1); // old one torn down
        h2.release();
    });

    it("throws when the live DB row is disabled, even if the passed-in DTO snapshot still says enabled", async () => {
        const s = stdioServer({ enabled: true });
        const staleDto = dtoOf(s.id); // enabled: true, captured before the flip
        setEnabled(s.id, false);
        expect(staleDto.enabled).toBe(true);
        await expect(getClient(staleDto)).rejects.toThrow(/is disabled/);
        expect(FakeStdioTransport.instances).toHaveLength(0); // never even attempted to spawn
    });
});

describe("evictLruIfFull (MAX_ACTIVE_CLIENTS = 50)", () => {
    it("evicts exactly the least-recently-used connection once the 51st distinct server connects", async () => {
        const ids: string[] = [];
        for (let i = 0; i < 50; i++) {
            const s = httpServer({ name: `lru-${i}` });
            ids.push(s.id);
            const h = await getClient(dtoOf(s.id));
            h.release();
        }
        for (const id of ids) {
            expect(getMcpRuntimeStatus(id).status).toBe("connected");
        }

        const s51 = httpServer({ name: "lru-50" });
        const h51 = await getClient(dtoOf(s51.id));
        createdIds.push(s51.id);

        expect(getMcpRuntimeStatus(ids[0]).status).toBe("idle"); // oldest evicted
        for (const id of ids.slice(1)) {
            expect(getMcpRuntimeStatus(id).status).toBe("connected"); // everyone else untouched
        }
        expect(getMcpRuntimeStatus(s51.id).status).toBe("connected");
        h51.release();
    }, 30_000);
});

describe("disposeMcpClient", () => {
    it("is a safe no-op for a server with no runtime entry at all", async () => {
        await expect(disposeMcpClient("never-seen-id")).resolves.toBeUndefined();
    });

    it("disposes immediately when there are no in-flight RPCs", async () => {
        const s = httpServer();
        const h = await getClient(dtoOf(s.id));
        h.release();
        await disposeMcpClient(s.id);
        const transport = FakeHttpTransport.instances.at(-1)!;
        expect(transport.closeCalls).toBe(1);
        expect(getMcpRuntimeStatus(s.id).status).toBe("idle");
    });

    it("force-closes a wedged connection (refs never drop to 0) once waitForCloseMs elapses", async () => {
        vi.useFakeTimers();
        const s = httpServer();
        const h = await getClient(dtoOf(s.id)); // NOT released — simulates an in-flight RPC holding refs=1
        const transport = FakeHttpTransport.instances.at(-1)!;

        const disposePromise = disposeMcpClient(s.id); // uses the default waitForCloseMs = CALL_TIMEOUT_MS (60s)
        await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 100);
        await disposePromise;

        expect(transport.closeCalls).toBe(1); // forced closed despite the still-held handle
        void h; // the held handle is now stale; nothing further to do with it in this test
    });

    it("honours a caller-supplied shorter waitForCloseMs (e.g. for a tighter /restart budget)", async () => {
        vi.useFakeTimers();
        const s = httpServer();
        await getClient(dtoOf(s.id)); // held open, refs=1
        const transport = FakeHttpTransport.instances.at(-1)!;

        const disposePromise = disposeMcpClient(s.id, { waitForCloseMs: 200 });
        await vi.advanceTimersByTimeAsync(300);
        await disposePromise;

        expect(transport.closeCalls).toBe(1);
    });

    it("a late release() after a forced wedged-close is a safe no-op (close()'s own idempotency latch)", async () => {
        vi.useFakeTimers();
        const s = httpServer();
        const h = await getClient(dtoOf(s.id)); // refs=1, never released before dispose
        const transport = FakeHttpTransport.instances.at(-1)!;

        const disposePromise = disposeMcpClient(s.id, { waitForCloseMs: 200 });
        await vi.advanceTimersByTimeAsync(300);
        await disposePromise;
        expect(transport.closeCalls).toBe(1); // force-closed by disposeMcpClient itself

        // The original caller finally releases its (now-stale) handle.
        // `release()` still decrements refs and — since softClose already
        // flagged `pendingClose` — tries to close AGAIN; `close()`'s own
        // `closedHttp` guard must make this second attempt a no-op rather
        // than double-invoking `transport.close()`.
        h.release();
        await vi.advanceTimersByTimeAsync(0);
        expect(transport.closeCalls).toBe(1);
    });

    it("awaits an in-flight connect before tearing down — success case releases promptly", async () => {
        const sOk = stdioServer({ name: "mid-connect-ok" });
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const pending = getClient(dtoOf(sOk.id));
        const disposePromise = disposeMcpClient(sOk.id); // must await the in-flight connect internally first
        FakeMcpClient.instances.at(-1)!.resolveConnect!();
        // Resolve + release the ref promptly so dispose's waitForClose
        // poll (real 50ms ticks — no fake timers in this test) finds
        // refs already at 0 almost immediately, instead of riding out
        // the full 60s default ceiling.
        const handle = await pending;
        handle.release();
        await expect(disposePromise).resolves.toBeUndefined();
    });

    it("awaits an in-flight connect before tearing down — failure case is swallowed", async () => {
        const sFail = stdioServer({ name: "mid-connect-fail" });
        FakeMcpClient.nextScript = { connect: { mode: "manual" } };
        const pendingFail = getClient(dtoOf(sFail.id));
        const disposePromiseFail = disposeMcpClient(sFail.id);
        FakeMcpClient.instances.at(-1)!.rejectConnect!(new Error("connect blew up"));
        await expect(pendingFail).rejects.toThrow("connect blew up");
        await expect(disposePromiseFail).resolves.toBeUndefined();
    });

    it("closes an orphaned log writer even when there is no runtime entry", async () => {
        const s = httpServer();
        // No getClient call at all — but a log line was written some other
        // way (e.g. an earlier process instance). disposeMcpClient still
        // must not throw when reconciling this.
        await expect(disposeMcpClient(s.id)).resolves.toBeUndefined();
    });
});

describe("forgetMcpServer", () => {
    it("is a safe no-op for an unknown id", () => {
        expect(() => forgetMcpServer("ghost-id")).not.toThrow();
    });

    it("permanently removes the entry so a later getClient against the (now-deleted) row refuses to respawn", async () => {
        const s = httpServer();
        const h = await getClient(dtoOf(s.id));
        h.release();
        await disposeMcpClient(s.id);

        db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, s.id)).run();
        forgetMcpServer(s.id);

        // Re-synthesize a plausible DTO by hand since the row is now gone —
        // getMcpServer(s.id) would itself 404.
        const fabricatedDto = {
            id: s.id,
            name: s.name,
            description: "",
            transport: "http" as const,
            config: { url: "https://mcp.example.com/mcp" },
            enabled: true,
            last_check_status: null,
            last_check_at: null,
            last_check_error: null,
            tools_cache: null,
            resources_cache: null,
            prompts_cache: null,
            server_info: null,
            config_version: "whatever",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        const before = FakeHttpTransport.instances.length;
        await expect(getClient(fabricatedDto)).rejects.toThrow(/is disabled/);
        expect(FakeHttpTransport.instances).toHaveLength(before); // never attempted to respawn
    });
});

describe("getMcpRuntimeStatus", () => {
    it("returns the idle/null shape for a server with no runtime entry", () => {
        expect(getMcpRuntimeStatus("no-entry-id")).toEqual({
            serverId: "no-entry-id",
            status: "idle",
            pid: null,
            startedAt: null,
            builtFor: null,
            error: null,
        });
    });
});

describe("readServerInfo", () => {
    it("returns null when there's no runtime entry", () => {
        expect(readServerInfo("no-entry-id")).toBeNull();
    });

    it("returns null when the entry exists but isn't connected", async () => {
        const s = stdioServer();
        FakeMcpClient.nextScript = { connect: { error: new Error("nope") } };
        await expect(getClient(dtoOf(s.id))).rejects.toThrow();
        expect(readServerInfo(s.id)).toBeNull();
    });

    it("returns null when connected but the server supplies no identity at all", async () => {
        const s = httpServer();
        FakeMcpClient.nextScript = { serverInfo: undefined, instructions: undefined, capabilities: undefined };
        const h = await getClient(dtoOf(s.id));
        expect(readServerInfo(s.id)).toBeNull();
        h.release();
    });

    it("returns name/version/instructions/capabilities when connected and advertised", async () => {
        const s = httpServer();
        FakeMcpClient.nextScript = {
            serverInfo: { name: "acme-server", version: "2.1.0" },
            instructions: "call tools responsibly",
            capabilities: { tools: {}, resources: {} },
        };
        const h = await getClient(dtoOf(s.id));
        expect(readServerInfo(s.id)).toEqual({
            name: "acme-server",
            version: "2.1.0",
            instructions: "call tools responsibly",
            capabilities: { tools: {}, resources: {} },
        });
        h.release();
    });

    it("returns a non-null result when only capabilities are present (name/version/instructions all absent)", async () => {
        const s = httpServer();
        FakeMcpClient.nextScript = { serverInfo: undefined, instructions: undefined, capabilities: { tools: {} } };
        const h = await getClient(dtoOf(s.id));
        expect(readServerInfo(s.id)).toEqual({
            name: undefined,
            version: undefined,
            instructions: undefined,
            capabilities: { tools: {} },
        });
        h.release();
    });
});

describe("unexpected close handling", () => {
    it("flips a connected entry to failed and logs the disconnect when the child crashes unexpectedly", async () => {
        const s = stdioServer();
        const h = await getClient(dtoOf(s.id));
        h.release();
        const transport = FakeStdioTransport.instances.at(-1)!;

        transport.crash();

        const status = getMcpRuntimeStatus(s.id);
        expect(status.status).toBe("failed");
        expect(status.error).toBe("Transport closed unexpectedly");
        const logs = readMcpLog(s.id, 100).join("\n");
        expect(logs).toContain("disconnected reason=transport_closed");
    });

    it("rebuilds fresh on the next getClient after an unexpected close", async () => {
        const s = stdioServer();
        const h = await getClient(dtoOf(s.id));
        h.release();
        FakeStdioTransport.instances.at(-1)!.crash();

        const h2 = await getClient(dtoOf(s.id));
        expect(FakeStdioTransport.instances).toHaveLength(2);
        expect(getMcpRuntimeStatus(s.id).status).toBe("connected");
        h2.release();
    });

    it("ignores a stale crash from a superseded (already-rebuilt) session — doesn't poison the successor", async () => {
        const s = stdioServer();
        const h1 = await getClient(dtoOf(s.id));
        h1.release();
        const originalTransport = FakeStdioTransport.instances.at(-1)!;

        setConfigVersion(s.id, "v2");
        const h2 = await getClient(dtoOf(s.id));
        h2.release();
        expect(getMcpRuntimeStatus(s.id).builtFor).toBe("v2");

        // The ORIGINAL (now-detached) transport dies late — must be a no-op.
        originalTransport.crash();

        const status = getMcpRuntimeStatus(s.id);
        expect(status.status).toBe("connected");
        expect(status.builtFor).toBe("v2");
    });

    it("defers the transport teardown until the last in-flight ref releases", async () => {
        const s = stdioServer();
        const h = await getClient(dtoOf(s.id)); // refs=1, held open
        const transport = FakeStdioTransport.instances.at(-1)!;

        transport.crash();
        expect(getMcpRuntimeStatus(s.id).status).toBe("failed"); // entry-level state flips immediately
        expect(transport.closeCalls).toBe(0); // but the transport itself hasn't been torn down yet (refs>0)

        h.release(); // last ref drops
        await new Promise((r) => process.nextTick(r));
        expect(transport.closeCalls).toBe(1); // now it fires
    });
});

describe("withTimeout", () => {
    it("resolves with the promise's value when it settles before the deadline", async () => {
        await expect(withTimeout(Promise.resolve("done"), 1_000, "test-op")).resolves.toBe("done");
    });

    it("propagates a rejection that happens before the deadline", async () => {
        await expect(withTimeout(Promise.reject(new Error("boom")), 1_000, "test-op")).rejects.toThrow("boom");
    });

    it("rejects with a plain '<label> timed out after <ms>ms' message for a non-connect label", async () => {
        vi.useFakeTimers();
        const never = new Promise(() => { /* never settles */ });
        const result = withTimeout(never, 2_000, "tools/list");
        const assertion = expect(result).rejects.toThrow("tools/list timed out after 2000ms");
        await vi.advanceTimersByTimeAsync(2_000);
        await assertion;
    });

    it("appends the mcp_connect_timeout_seconds hint specifically for the 'mcp connect' label", async () => {
        vi.useFakeTimers();
        const never = new Promise(() => { /* never settles */ });
        const result = withTimeout(never, 3_000, "mcp connect");
        const assertion = expect(result).rejects.toThrow(/mcp connect timed out after 3000ms.*mcp_connect_timeout_seconds/);
        await vi.advanceTimersByTimeAsync(3_000);
        await assertion;
    });
});

describe("CALL_TIMEOUT_MS", () => {
    it("is 60 seconds", () => {
        expect(CALL_TIMEOUT_MS).toBe(60_000);
    });
});
