import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedMcpServer } from "../../helpers/db";

vi.mock("@/lib/server/mcp/runtime", () => ({
    getClient: vi.fn(),
    // Faithful (unmocked-behaviour) reimplementation — withTimeout itself
    // is a pure Promise-race utility with no SDK/DB/network dependency,
    // but it lives in runtime.ts which we must not import for real (that
    // would drag in the actual MCP SDK modules). dispatch.ts only cares
    // that it races the promise against `ms` and rejects past that point.
    withTimeout: vi.fn(async (promise: Promise<unknown>, ms: number, label: string) => {
        let timer: ReturnType<typeof setTimeout>;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
                }),
            ]);
        } finally {
            clearTimeout(timer!);
        }
    }),
    CALL_TIMEOUT_MS: 60_000,
}));
vi.mock("@/lib/server/mcp/protocol", () => ({
    listToolsForServer: vi.fn(async () => []),
}));

import { getClient } from "@/lib/server/mcp/runtime";
import { listToolsForServer } from "@/lib/server/mcp/protocol";
import {
    aggregateTools,
    executeTool,
    qualify,
    sanitize,
    unqualify,
} from "@/lib/server/mcp/dispatch";

const getClientMock = vi.mocked(getClient);

/** The runtime's client handle, derived from the function under mock so the
 *  tests don't need a new production export. */
type ClientHandle = Awaited<ReturnType<typeof getClient>>;
const listToolsMock = vi.mocked(listToolsForServer);

beforeEach(() => {
    resetDb();
    listToolsMock.mockReset().mockResolvedValue([]);
    getClientMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("sanitize", () => {
    it("passes alphanumeric/underscore/dash through untouched", () => {
        expect(sanitize("my-server_1")).toBe("my-server_1");
    });

    it("replaces any other character with an underscore", () => {
        expect(sanitize("my server!")).toBe("my_server_");
    });

    it("truncates to 32 characters", () => {
        const long = "a".repeat(50);
        expect(sanitize(long)).toBe("a".repeat(32));
    });
});

describe("qualify / unqualify", () => {
    it("qualify mangles sanitized-server-name + separator + raw tool name", () => {
        expect(qualify("my server", "do_thing")).toBe("my_server__do_thing");
    });

    it("qualify does NOT sanitize the tool name itself", () => {
        expect(qualify("srv", "weird tool!")).toBe("srv__weird tool!");
    });

    it("unqualify splits a normal qualified name on the first separator", () => {
        expect(unqualify("srv__tool")).toEqual({ serverPrefix: "srv", toolName: "tool" });
    });

    it("unqualify splits on the FIRST '__' even when the tool name itself contains '__'", () => {
        expect(unqualify("srv__tool__extra")).toEqual({ serverPrefix: "srv", toolName: "tool__extra" });
    });

    it("unqualify returns null when there's no separator at all", () => {
        expect(unqualify("nosep")).toBeNull();
    });

    it("unqualify returns null when the separator is at position 0 (empty prefix)", () => {
        expect(unqualify("__tool")).toBeNull();
    });

    it("unqualify returns null for an empty string", () => {
        expect(unqualify("")).toBeNull();
    });
});

describe("aggregateTools", () => {
    it("returns empty immediately for an empty id list", async () => {
        const result = await aggregateTools([]);
        expect(result).toEqual({ tools: [], errors: [] });
        expect(listToolsMock).not.toHaveBeenCalled();
    });

    it("ignores ids that don't exist in the DB", async () => {
        const result = await aggregateTools(["ghost-id"]);
        expect(result).toEqual({ tools: [], errors: [] });
    });

    it("filters out disabled servers silently (no tools, no error entry)", async () => {
        const s = seedMcpServer({ enabled: false });
        const result = await aggregateTools([s.id]);
        expect(result).toEqual({ tools: [], errors: [] });
        expect(listToolsMock).not.toHaveBeenCalled();
    });

    it("serves from tools_cache without calling listToolsForServer when the check is fresh and ok", async () => {
        const s = seedMcpServer({
            name: "cached-srv",
            enabled: true,
            lastCheckStatus: "ok",
            lastCheckAt: new Date().toISOString(),
            toolsCache: [{ name: "cached-tool", description: "d", parameters: { type: "object" } }],
        });
        const result = await aggregateTools([s.id]);
        expect(listToolsMock).not.toHaveBeenCalled();
        expect(result.tools).toEqual([
            {
                qualifiedName: "cached-srv__cached-tool",
                localName: "cached-tool",
                description: "d",
                parameters: { type: "object" },
                serverId: s.id,
                serverName: "cached-srv",
            },
        ]);
    });

    it("falls through to listToolsForServer when the cached check is older than the 5-minute TTL", async () => {
        const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        const s = seedMcpServer({
            enabled: true,
            lastCheckStatus: "ok",
            lastCheckAt: stale,
            toolsCache: [{ name: "old-tool", parameters: {} }],
        });
        listToolsMock.mockResolvedValue([
            { qualifiedName: "q", localName: "fresh-tool", parameters: {}, serverId: s.id, serverName: s.name },
        ]);
        const result = await aggregateTools([s.id]);
        expect(listToolsMock).toHaveBeenCalledTimes(1);
        expect(result.tools.map((t) => t.localName)).toEqual(["fresh-tool"]);
    });

    it("falls through to listToolsForServer when last_check_status is 'error' even with a stale cache present", async () => {
        const s = seedMcpServer({
            enabled: true,
            lastCheckStatus: "error",
            lastCheckAt: new Date().toISOString(),
            toolsCache: [{ name: "leftover", parameters: {} }],
        });
        await aggregateTools([s.id]);
        expect(listToolsMock).toHaveBeenCalledTimes(1);
    });

    it("falls through to listToolsForServer when tools_cache is null despite an ok status", async () => {
        const s = seedMcpServer({ enabled: true, lastCheckStatus: "ok", lastCheckAt: new Date().toISOString(), toolsCache: null });
        await aggregateTools([s.id]);
        expect(listToolsMock).toHaveBeenCalledTimes(1);
    });

    it("treats a missing last_check_at as infinitely stale", async () => {
        const s = seedMcpServer({ enabled: true, lastCheckStatus: "ok", lastCheckAt: null, toolsCache: [{ name: "x", parameters: {} }] });
        await aggregateTools([s.id]);
        expect(listToolsMock).toHaveBeenCalledTimes(1);
    });

    it("treats an unparseable last_check_at as infinitely stale", async () => {
        const s = seedMcpServer({
            enabled: true,
            lastCheckStatus: "ok",
            lastCheckAt: "not-a-real-date",
            toolsCache: [{ name: "x", parameters: {} }],
        });
        await aggregateTools([s.id]);
        expect(listToolsMock).toHaveBeenCalledTimes(1);
    });

    it("treats a fresh last_check_at with no timezone suffix as still-fresh (Z gets appended before parsing)", async () => {
        const s = seedMcpServer({
            enabled: true,
            lastCheckStatus: "ok",
            lastCheckAt: new Date().toISOString().replace("Z", ""),
            toolsCache: [{ name: "x", parameters: {} }],
        });
        await aggregateTools([s.id]);
        expect(listToolsMock).not.toHaveBeenCalled();
    });

    it("treats a fresh last_check_at with an explicit +hh:mm offset as still-fresh (no Z appended)", async () => {
        const s = seedMcpServer({
            enabled: true,
            lastCheckStatus: "ok",
            lastCheckAt: new Date().toISOString().replace("Z", "+00:00"),
            toolsCache: [{ name: "x", parameters: {} }],
        });
        await aggregateTools([s.id]);
        expect(listToolsMock).not.toHaveBeenCalled();
    });

    it("isolates a per-server failure: other servers' tools still come back, the failure lands in errors[]", async () => {
        const good = seedMcpServer({ name: "good-srv", enabled: true });
        const bad = seedMcpServer({ name: "bad-srv", enabled: true });
        listToolsMock.mockImplementation(async (server) => {
            if (server.id === bad.id) throw new Error("upstream exploded");
            return [{ qualifiedName: "q", localName: "ok-tool", parameters: {}, serverId: server.id, serverName: server.name }];
        });
        const result = await aggregateTools([good.id, bad.id]);
        expect(result.tools).toHaveLength(1);
        expect(result.tools[0].serverId).toBe(good.id);
        expect(result.errors).toEqual([{ serverId: bad.id, serverName: "bad-srv", message: "upstream exploded" }]);
    });

    it("stringifies a non-Error throw from listToolsForServer", async () => {
        const s = seedMcpServer({ enabled: true });
        listToolsMock.mockRejectedValue("raw string failure");
        const result = await aggregateTools([s.id]);
        expect(result.errors).toEqual([{ serverId: s.id, serverName: s.name, message: "raw string failure" }]);
    });

    it("times out a server stuck in listToolsForServer after 10s and reports it as an error, not hanging forever", async () => {
        vi.useFakeTimers();
        const s = seedMcpServer({ enabled: true });
        listToolsMock.mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const promise = aggregateTools([s.id]);
        await vi.advanceTimersByTimeAsync(10_000);
        const result = await promise;
        expect(result.tools).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toMatch(/Aggregation timeout after 10000ms/);
    });
});

describe("executeTool", () => {
    // A ClientHandle carrying only the one method dispatch actually calls.
    // The real SDK Client has ~75 private fields, so a structural mock has to
    // be cast — the alternative is instantiating a real transport.
    function client(callTool: ReturnType<typeof vi.fn>): ClientHandle {
        return { client: { callTool }, builtFor: "v1", release: vi.fn() } as unknown as ClientHandle;
    }

    it("rejects a malformed qualified name with no separator", async () => {
        const result = await executeTool("nosep", "{}");
        expect(result).toEqual({
            content: expect.stringContaining('Bad qualified tool name "nosep"'),
            isError: true,
            serverName: null,
        });
        expect(getClientMock).not.toHaveBeenCalled();
    });

    it("rejects a qualified name with an empty server prefix", async () => {
        const result = await executeTool("__tool", "{}");
        expect(result.isError).toBe(true);
        expect(result.serverName).toBeNull();
    });

    it("reports no matching server for an unknown prefix", async () => {
        const result = await executeTool("ghost__tool", "{}");
        expect(result.isError).toBe(true);
        expect(result.serverName).toBeNull();
        expect(result.content).toMatch(/No MCP server matches prefix "ghost"/);
    });

    it("refuses to dispatch to a disabled server, attributing the error to it by name", async () => {
        seedMcpServer({ name: "sleepy", enabled: false });
        const result = await executeTool("sleepy__tool", "{}");
        expect(result).toEqual({
            content: expect.stringContaining('MCP server "sleepy" is disabled'),
            isError: true,
            serverName: "sleepy",
        });
        expect(getClientMock).not.toHaveBeenCalled();
    });

    it("reports malformed JSON arguments without ever calling getClient", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const badJson = `{not valid json ${"x".repeat(300)}`;
        const result = await executeTool("srv__tool", badJson);
        expect(result.isError).toBe(true);
        expect(result.serverName).toBe("srv");
        expect(result.content).toMatch(/^Invalid JSON arguments from model: /);
        expect(result.content.length).toBeLessThanOrEqual(200 + "Invalid JSON arguments from model: ".length);
        expect(getClientMock).not.toHaveBeenCalled();
    });

    it("treats an empty rawArgs string as an empty-object call, not a JSON error", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(async () => ({ content: "ok", isError: false }));
        getClientMock.mockResolvedValue(client(callTool));
        const result = await executeTool("srv__tool", "");
        expect(result.isError).toBe(false);
        expect(callTool).toHaveBeenCalledWith({ name: "tool", arguments: {} });
    });

    it("passes parsed JSON arguments and the unqualified tool name through to callTool", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(async () => ({ content: "ok", isError: false }));
        getClientMock.mockResolvedValue(client(callTool));
        await executeTool("srv__my_tool", JSON.stringify({ a: 1 }));
        expect(callTool).toHaveBeenCalledWith({ name: "my_tool", arguments: { a: 1 } });
    });

    it("attributes a getClient (connect) failure to the server and never throws", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        getClientMock.mockRejectedValue(new Error("spawn ENOENT"));
        const result = await executeTool("srv__tool", "{}");
        expect(result).toEqual({ content: "spawn ENOENT", isError: true, serverName: "srv" });
    });

    it("attributes a callTool (RPC) failure to the server AND still releases the client handle", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(async () => { throw new Error("tool crashed"); });
        const handle = client(callTool);
        getClientMock.mockResolvedValue(handle);
        const result = await executeTool("srv__tool", "{}");
        expect(result).toEqual({ content: "tool crashed", isError: true, serverName: "srv" });
        expect(handle.release).toHaveBeenCalledTimes(1);
    });

    it("stringifies a non-Error throw from callTool", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(async () => { throw "raw rejection"; });
        getClientMock.mockResolvedValue(client(callTool));
        const result = await executeTool("srv__tool", "{}");
        expect(result.content).toBe("raw rejection");
    });

    it("releases the client handle exactly once on a successful call", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(async () => ({ content: "ok", isError: false }));
        const handle = client(callTool);
        getClientMock.mockResolvedValue(handle);
        await executeTool("srv__tool", "{}");
        expect(handle.release).toHaveBeenCalledTimes(1);
    });

    it("propagates result.isError=true from a tool that ran but reported failure", async () => {
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "tool-level error" }], isError: true }));
        getClientMock.mockResolvedValue(client(callTool));
        const result = await executeTool("srv__tool", "{}");
        expect(result.isError).toBe(true);
        expect(result.content).toBe("tool-level error");
    });

    it("times out a call stuck past CALL_TIMEOUT_MS", async () => {
        vi.useFakeTimers();
        seedMcpServer({ name: "srv", enabled: true });
        const callTool = vi.fn(() => new Promise(() => { /* never resolves */ }));
        getClientMock.mockResolvedValue(client(callTool));
        const promise = executeTool("srv__tool", "{}");
        await vi.advanceTimersByTimeAsync(60_000);
        const result = await promise;
        expect(result.isError).toBe(true);
        expect(result.content).toMatch(/timed out after 60000ms/);
    });

    describe("content flattening", () => {
        async function callWith(content: unknown, isError = false) {
            seedMcpServer({ name: "srv", enabled: true });
            const callTool = vi.fn(async () => ({ content, isError }));
            getClientMock.mockResolvedValue(client(callTool));
            return executeTool("srv__tool", "{}");
        }

        it("joins multiple text blocks with a newline", async () => {
            const result = await callWith([{ type: "text", text: "line one" }, { type: "text", text: "line two" }]);
            expect(result.content).toBe("line one\nline two");
        });

        it("tags a non-text block with its type and a truncated JSON preview", async () => {
            const result = await callWith([{ type: "image", data: "base64stuff" }]);
            expect(result.content).toMatch(/^\[image] /);
            expect(result.content).toContain('"type":"image"');
        });

        it("tags a typeless block as 'unknown'", async () => {
            const result = await callWith([{ data: "no type field here" }]);
            expect(result.content).toMatch(/^\[unknown] /);
        });

        it("passes a plain string content through untouched", async () => {
            const result = await callWith("already a string");
            expect(result.content).toBe("already a string");
        });

        it("JSON-stringifies a non-array, non-string content value", async () => {
            const result = await callWith({ weird: "shape" });
            expect(result.content).toBe(JSON.stringify({ weird: "shape" }));
        });

        it("falls back to an empty-string JSON literal for null content", async () => {
            const result = await callWith(null);
            expect(result.content).toBe(JSON.stringify(""));
        });

        it("returns an empty string for an empty content array", async () => {
            const result = await callWith([]);
            expect(result.content).toBe("");
        });

        it("truncates content past MAX_TOOL_CONTENT_BYTES and reports the dropped byte count", async () => {
            const MAX = 256 * 1024 - 64;
            const huge = "a".repeat(MAX + 1000);
            const result = await callWith(huge);
            expect(result.content.length).toBeGreaterThan(MAX);
            expect(result.content).toMatch(/\n…\[truncated, 1000 more bytes]$/);
            expect(result.content.startsWith("a".repeat(50))).toBe(true);
        });

        it("does not truncate content sitting exactly at the byte cap", async () => {
            const MAX = 256 * 1024 - 64;
            const exact = "b".repeat(MAX);
            const result = await callWith(exact);
            expect(result.content).toBe(exact);
        });
    });
});
