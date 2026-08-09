import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, seedMcpServer } from "../../helpers/db";

vi.mock("@/lib/server/mcp/runtime", () => ({
    getClient: vi.fn(async () => ({ client: {}, builtFor: "v1", release: vi.fn() })),
    listToolsForServer: vi.fn(async () => []),
    listResourcesForServer: vi.fn(async () => null),
    listPromptsForServer: vi.fn(async () => null),
    readServerInfo: vi.fn(() => null),
}));

import {
    getClient,
    listPromptsForServer,
    listResourcesForServer,
    listToolsForServer,
    readServerInfo,
} from "@/lib/server/mcp/runtime";
import { checkMcpServer, runMcpCheck, type McpCheckEvent } from "@/lib/server/mcp/checks";
import { db, schema } from "@/lib/server/db";

const getClientMock = vi.mocked(getClient);

/** The runtime's client handle, derived from the function under mock so the
 *  tests don't need a new production export. */
type ClientHandle = Awaited<ReturnType<typeof getClient>>;
const listToolsMock = vi.mocked(listToolsForServer);
const listResourcesMock = vi.mocked(listResourcesForServer);
const listPromptsMock = vi.mocked(listPromptsForServer);
const readServerInfoMock = vi.mocked(readServerInfo);

function freshRelease() {
    return vi.fn();
}

beforeEach(() => {
    resetDb();
    getClientMock.mockReset().mockImplementation(async () => ({ client: {}, builtFor: "v1", release: freshRelease() } as unknown as ClientHandle));
    listToolsMock.mockReset().mockResolvedValue([]);
    listResourcesMock.mockReset().mockResolvedValue(null);
    listPromptsMock.mockReset().mockResolvedValue(null);
    readServerInfoMock.mockReset().mockReturnValue(null);
});

function collectEvents(): { events: McpCheckEvent[]; onEvent: (ev: McpCheckEvent) => void } {
    const events: McpCheckEvent[] = [];
    return { events, onEvent: (ev) => events.push(ev) };
}

function rowOf(id: string) {
    return db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get();
}

describe("runMcpCheck", () => {
    it("returns null for an unknown server id without touching the DB or emitting events", async () => {
        const { events, onEvent } = collectEvents();
        const result = await runMcpCheck("nope", onEvent);
        expect(result).toBeNull();
        expect(events).toEqual([]);
        expect(getClientMock).not.toHaveBeenCalled();
    });

    it("bails immediately for a disabled server, emitting an error event and never touching getClient", async () => {
        const s = seedMcpServer({ enabled: false });
        const { events, onEvent } = collectEvents();
        const result = await runMcpCheck(s.id, onEvent);
        expect(result?.enabled).toBe(false);
        expect(events).toEqual([
            { type: "error", message: expect.stringMatching(/disabled/i), server: expect.objectContaining({ id: s.id }) },
        ]);
        expect(getClientMock).not.toHaveBeenCalled();
    });

    it("happy path: persists tools/resources/prompts snapshots, server info, and emits phase + result events", async () => {
        const s = seedMcpServer({ enabled: true });
        listToolsMock.mockResolvedValue([
            { qualifiedName: "s__t1", localName: "t1", description: "tool one", parameters: { type: "object" }, serverId: s.id, serverName: s.name },
        ]);
        listResourcesMock.mockResolvedValue({
            resources: [{ uri: "file:///a", name: "a" }],
            templates: [{ uriTemplate: "file:///{id}" }],
        });
        listPromptsMock.mockResolvedValue([{ name: "greet", description: "say hi" }]);
        readServerInfoMock.mockReturnValue({ name: "srv", version: "1.0", capabilities: { tools: {} } });

        const { events, onEvent } = collectEvents();
        const result = await runMcpCheck(s.id, onEvent);

        expect(result?.last_check_status).toBe("ok");
        expect(result?.tools_cache).toEqual([{ name: "t1", description: "tool one", parameters: { type: "object" } }]);
        expect(result?.resources_cache).toEqual({
            resources: [{ uri: "file:///a", name: "a" }],
            templates: [{ uriTemplate: "file:///{id}" }],
        });
        expect(result?.prompts_cache).toEqual([{ name: "greet", description: "say hi" }]);
        expect(result?.server_info).toEqual({ name: "srv", version: "1.0", capabilities: { tools: {} } });

        expect(events).toContainEqual({ type: "phase", phase: "listing" });
        expect(events.at(-1)).toEqual({ type: "result", server: expect.objectContaining({ id: s.id }) });

        const row = rowOf(s.id);
        expect(row?.lastCheckStatus).toBe("ok");
        expect(row?.lastCheckError).toBeNull();
        // Re-check must not disturb the config-version sentinel.
        expect(row?.configVersion).toBe(s.configVersion);
    });

    it("releases the probe client handle exactly once", async () => {
        const release = vi.fn();
        getClientMock.mockResolvedValueOnce({ client: {}, builtFor: "v1", release } as unknown as ClientHandle);
        const s = seedMcpServer({ enabled: true });
        await runMcpCheck(s.id, () => {});
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("forwards onPhase/onLog hook calls from the client-build phase as phase/log events", async () => {
        getClientMock.mockImplementationOnce(async (_dto, hooks) => {
            hooks?.onPhase?.("spawning");
            hooks?.onLog?.("child stderr line");
            return { client: {}, builtFor: "v1", release: vi.fn() } as unknown as ClientHandle;
        });
        const s = seedMcpServer({ enabled: true });
        const { events, onEvent } = collectEvents();
        await runMcpCheck(s.id, onEvent);
        expect(events).toContainEqual({ type: "phase", phase: "spawning" });
        expect(events).toContainEqual({ type: "log", line: "child stderr line" });
    });

    it("treats a server with no resources/prompts capability (null) as a no-op section, not an error", async () => {
        listResourcesMock.mockResolvedValue(null);
        listPromptsMock.mockResolvedValue(null);
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.last_check_status).toBe("ok");
        expect(result?.resources_cache).toBeNull();
        expect(result?.prompts_cache).toBeNull();
    });

    it("swallows a listResourcesForServer throw (capability advertised but call failed) without failing the whole check", async () => {
        listResourcesMock.mockRejectedValue(new Error("Method not found"));
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.last_check_status).toBe("ok");
        expect(result?.resources_cache).toBeNull();
    });

    it("swallows a listPromptsForServer throw (capability advertised but call failed) without failing the whole check", async () => {
        listPromptsMock.mockRejectedValue(new Error("Method not found"));
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.last_check_status).toBe("ok");
        expect(result?.prompts_cache).toBeNull();
    });

    it("a tools/list failure (load-bearing) fails the whole check and preserves the prior snapshot", async () => {
        const s = seedMcpServer({
            enabled: true,
            toolsCache: [{ name: "old-tool", parameters: {} }],
            lastCheckStatus: "ok",
        });
        listToolsMock.mockRejectedValue(new Error("upstream ECONNRESET"));
        const { events, onEvent } = collectEvents();
        const result = await runMcpCheck(s.id, onEvent);
        expect(result?.last_check_status).toBe("error");
        expect(result?.last_check_error).toBe("upstream ECONNRESET");
        // Prior snapshot must survive a failed re-check.
        expect(result?.tools_cache).toEqual([{ name: "old-tool", parameters: {} }]);
        expect(events).toContainEqual({
            type: "error",
            message: "upstream ECONNRESET",
            server: expect.objectContaining({ id: s.id }),
        });
    });

    it("a getClient (connect) failure fails the whole check with the thrown message", async () => {
        getClientMock.mockRejectedValue(new Error("spawn ENOENT"));
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.last_check_status).toBe("error");
        expect(result?.last_check_error).toBe("spawn ENOENT");
    });

    it("truncates an overly long error message to 4000 characters", async () => {
        getClientMock.mockRejectedValue(new Error("x".repeat(5000)));
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.last_check_error).toHaveLength(4000);
    });

    it("stringifies a non-Error throw", async () => {
        getClientMock.mockRejectedValue("just a string rejection");
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.last_check_status).toBe("error");
        expect(result?.last_check_error).toBe("just a string rejection");
    });

    it("returns null from the error path when the row was deleted mid-check", async () => {
        const s = seedMcpServer({ enabled: true });
        getClientMock.mockImplementationOnce(async () => {
            db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, s.id)).run();
            throw new Error("boom after delete");
        });
        const result = await runMcpCheck(s.id, () => {});
        expect(result).toBeNull();
    });

    it("caps tools/resources/templates/prompts snapshots at their MAX_* limits", async () => {
        listToolsMock.mockResolvedValue(
            Array.from({ length: 501 }, (_, i) => ({
                qualifiedName: `s__t${i}`, localName: `t${i}`, parameters: {}, serverId: "x", serverName: "s",
            })),
        );
        listResourcesMock.mockResolvedValue({
            resources: Array.from({ length: 1001 }, (_, i) => ({ uri: `file:///${i}` })),
            templates: Array.from({ length: 201 }, (_, i) => ({ uriTemplate: `file:///{p${i}}` })),
        });
        listPromptsMock.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ name: `p${i}` })));
        const s = seedMcpServer({ enabled: true });
        const result = await runMcpCheck(s.id, () => {});
        expect(result?.tools_cache).toHaveLength(500);
        expect(result?.resources_cache?.resources).toHaveLength(1000);
        expect(result?.resources_cache?.templates).toHaveLength(200);
        expect(result?.prompts_cache).toHaveLength(500);
    });

    describe("mid-check disable race", () => {
        it("bails right after connect when the server was disabled mid-check, persisting an error and never listing tools", async () => {
            const s = seedMcpServer({ enabled: true });
            getClientMock.mockImplementationOnce(async () => {
                db.update(schema.mcpServers).set({ enabled: false }).where(eq(schema.mcpServers.id, s.id)).run();
                return { client: {}, builtFor: "v1", release: vi.fn() } as unknown as ClientHandle;
            });
            const { events, onEvent } = collectEvents();
            const result = await runMcpCheck(s.id, onEvent);
            expect(result?.last_check_status).toBe("error");
            expect(result?.last_check_error).toMatch(/disabled mid-check/i);
            expect(listToolsMock).not.toHaveBeenCalled();
            expect(events).toContainEqual({
                type: "error",
                message: expect.stringMatching(/disabled mid-check/i),
                server: expect.objectContaining({ id: s.id }),
            });
        });

        it("skips resources/prompts listing (but still writes an ok snapshot) when disabled between tools/list and the resources phase", async () => {
            const s = seedMcpServer({ enabled: true });
            listToolsMock.mockImplementationOnce(async () => {
                db.update(schema.mcpServers).set({ enabled: false }).where(eq(schema.mcpServers.id, s.id)).run();
                return [];
            });
            const result = await runMcpCheck(s.id, () => {});
            expect(listResourcesMock).not.toHaveBeenCalled();
            expect(listPromptsMock).not.toHaveBeenCalled();
            // Only signal-abort (not the enabled flip) gates the final
            // persistence step, so the snapshot still lands as "ok" even
            // though the server flipped disabled moments earlier.
            expect(result?.last_check_status).toBe("ok");
        });
    });

    describe("caller-abort via signal", () => {
        it("returns the pre-check DTO untouched when already aborted before connecting, skipping all list calls", async () => {
            const controller = new AbortController();
            controller.abort();
            const s = seedMcpServer({ enabled: true, lastCheckStatus: "ok", configVersion: "v1" });
            const { events, onEvent } = collectEvents();
            const result = await runMcpCheck(s.id, onEvent, { signal: controller.signal });
            expect(result).toEqual(expect.objectContaining({ id: s.id, last_check_status: "ok", config_version: "v1" }));
            expect(events).toEqual([]);
            expect(listToolsMock).not.toHaveBeenCalled();
            const row = rowOf(s.id);
            expect(row?.lastCheckStatus).toBe("ok"); // untouched — no DB write on cancel.
        });

        it("skips the final DB write and result event when aborted right after listing completes", async () => {
            const controller = new AbortController();
            const s = seedMcpServer({ enabled: true, lastCheckStatus: null, configVersion: "v1" });
            listToolsMock.mockImplementationOnce(async () => {
                controller.abort();
                return [];
            });
            const { events, onEvent } = collectEvents();
            const result = await runMcpCheck(s.id, onEvent, { signal: controller.signal });
            expect(result).toEqual(expect.objectContaining({ id: s.id }));
            expect(events.some((e) => e.type === "result")).toBe(false);
            const row = rowOf(s.id);
            expect(row?.lastCheckStatus).toBeNull(); // still untouched.
        });
    });
});

describe("checkMcpServer", () => {
    it("returns null for an unknown server", async () => {
        const result = await checkMcpServer("nope");
        expect(result).toBeNull();
    });

    it("discards events and forwards connectTimeoutMs to getClient's opts", async () => {
        const s = seedMcpServer({ enabled: true });
        const result = await checkMcpServer(s.id, 9_000);
        expect(result?.last_check_status).toBe("ok");
        expect(getClientMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: s.id }),
            expect.anything(),
            expect.objectContaining({ connectTimeoutMs: 9_000 }),
        );
    });
});
