import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/auth")>();
    return {
        ...actual,
        getCurrentUser: vi.fn(),
        requireUser: vi.fn(),
        requireAdmin: vi.fn(),
        authenticateGateway: vi.fn(),
    };
});

vi.mock("@/lib/server/mcp/checks", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/mcp/checks")>();
    return {
        ...actual,
        checkMcpServer: vi.fn(),
        runMcpCheck: vi.fn(),
    };
});

vi.mock("@/lib/server/mcp/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/mcp/runtime")>();
    return {
        ...actual,
        listToolsForServer: vi.fn(),
    };
});

import { GET as serversGET, POST as serversPOST } from "@/app/api/mcp/servers/route";
import { GET as serverGET, PATCH as serverPATCH, DELETE as serverDELETE } from "@/app/api/mcp/servers/[id]/route";
import { POST as checkPOST } from "@/app/api/mcp/servers/[id]/check/route";
import { POST as restartPOST } from "@/app/api/mcp/servers/[id]/restart/route";
import { GET as runtimeGET } from "@/app/api/mcp/servers/[id]/runtime/route";
import { POST as stopPOST } from "@/app/api/mcp/servers/[id]/stop/route";
import { GET as toolsGET } from "@/app/api/mcp/servers/[id]/tools/route";
import { GET as presetsGET } from "@/app/api/mcp/presets/route";
import { checkMcpServer, runMcpCheck } from "@/lib/server/mcp/checks";
import { listToolsForServer } from "@/lib/server/mcp/runtime";
import { resetDb, seedAdmin, seedMcpServer, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, envelope, getReq, patchJson, postJson, toSessionUser } from "./_helpers";

const mockCheckMcpServer = vi.mocked(checkMcpServer);
const mockRunMcpCheck = vi.mocked(runMcpCheck);
const mockListToolsForServer = vi.mocked(listToolsForServer);

describe("GET/POST /api/mcp/servers", () => {
    beforeEach(() => {
        resetDb();
        mockCheckMcpServer.mockReset().mockResolvedValue(null);
        mockRunMcpCheck.mockReset();
        mockListToolsForServer.mockReset();
    });

    it("401s anonymous callers on GET", async () => {
        asAnon();
        const res = await serversGET(getReq("/api/mcp/servers"));
        expect(res.status).toBe(401);
    });

    it("redacts config for a non-admin user but not for an admin", async () => {
        seedMcpServer({ name: "srv-a", config: { command: "echo", args: ["hi"], env: { TOKEN: "secret" } } });
        const user = seedUser();
        asUser(toSessionUser(user));
        const userRes = await serversGET(getReq("/api/mcp/servers"));
        expect(userRes.status).toBe(200);
        const userBody = await envelope<{ id: string; config: Record<string, unknown> }[]>(userRes);
        expect(userBody.data[0].config).toEqual({});

        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const adminRes = await serversGET(getReq("/api/mcp/servers"));
        const adminBody = await envelope<{ config: { env?: Record<string, string> } }[]>(adminRes);
        expect(adminBody.data[0].config.env?.TOKEN).toBe("secret");
    });

    it("403s a non-admin POST (create)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await serversPOST(
            postJson("/api/mcp/servers", { name: "x", transport: "stdio", config: { command: "echo" } }),
        );
        expect(res.status).toBe(403);
    });

    it("400s invalid create bodies (bad transport/config shape, unsafe name)", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));

        const missingCommand = await serversPOST(
            postJson("/api/mcp/servers", { name: "srv-b", transport: "stdio", config: {} }),
        );
        expect(missingCommand.status).toBe(400);

        const badUrl = await serversPOST(
            postJson("/api/mcp/servers", { name: "srv-c", transport: "http", config: { url: "not-a-url" } }),
        );
        expect(badUrl.status).toBe(400);

        const emptyName = await serversPOST(
            postJson("/api/mcp/servers", { name: "", transport: "stdio", config: { command: "echo" } }),
        );
        expect(emptyName.status).toBe(400);
    });

    it("400s a create whose sanitized name starts with _ or collides with another server's prefix", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));

        const leadingUnderscore = await serversPOST(
            postJson("/api/mcp/servers", { name: "___weird", transport: "stdio", config: { command: "echo" } }),
        );
        expect(leadingUnderscore.status).toBe(400);

        // Both "shared name" and "shared!name" sanitize (non [a-zA-Z0-9_-]
        // chars -> "_") to the same "shared_name" prefix.
        seedMcpServer({ name: "shared name" });
        const collision = await serversPOST(
            postJson("/api/mcp/servers", { name: "shared!name", transport: "stdio", config: { command: "echo" } }),
        );
        expect(collision.status).toBe(400);
    });

    it("400s a duplicate server name", async () => {
        const admin = seedAdmin();
        seedMcpServer({ name: "dup-name" });
        asAdmin(toSessionUser(admin));
        const res = await serversPOST(
            postJson("/api/mcp/servers", { name: "dup-name", transport: "stdio", config: { command: "echo" } }),
        );
        expect(res.status).toBe(400);
    });

    it("creates a server as admin and schedules a background check (fire-and-forget)", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockCheckMcpServer.mockResolvedValue(null);
        const res = await serversPOST(
            postJson("/api/mcp/servers", {
                name: "new-server",
                transport: "http",
                config: { url: "https://example.com/mcp" },
            }),
        );
        expect(res.status).toBe(200);
        const body = await envelope<{ id: string; name: string; enabled: boolean }>(res);
        expect(body.data.name).toBe("new-server");
        expect(body.data.enabled).toBe(true);
        expect(mockCheckMcpServer).toHaveBeenCalled();
    });
});

describe("GET/PATCH/DELETE /api/mcp/servers/[id]", () => {
    beforeEach(() => {
        resetDb();
        mockCheckMcpServer.mockReset().mockResolvedValue(null);
        mockRunMcpCheck.mockReset();
        mockListToolsForServer.mockReset();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await serverGET(getReq("/api/mcp/servers/x"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent server for GET/PATCH/DELETE", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        expect((await serverGET(getReq("/api/mcp/servers/nope"), ctx({ id: "nope" }))).status).toBe(404);
        expect(
            (await serverPATCH(patchJson("/api/mcp/servers/nope", { enabled: false }), ctx({ id: "nope" }))).status,
        ).toBe(404);
        expect((await serverDELETE(getReq("/api/mcp/servers/nope"), ctx({ id: "nope" }))).status).toBe(404);
    });

    it("403s a non-admin PATCH/DELETE", async () => {
        const server = seedMcpServer();
        const user = seedUser();
        asUser(toSessionUser(user));
        expect(
            (await serverPATCH(patchJson(`/api/mcp/servers/${server.id}`, { enabled: false }), ctx({ id: server.id })))
                .status,
        ).toBe(403);
        expect((await serverDELETE(getReq(`/api/mcp/servers/${server.id}`), ctx({ id: server.id }))).status).toBe(403);
    });

    it("a non-admin GET redacts config; an admin GET decrypts it", async () => {
        const server = seedMcpServer({ config: { command: "echo", env: { KEY: "sekrit" } } });
        const user = seedUser();
        asUser(toSessionUser(user));
        const userRes = await serverGET(getReq(`/api/mcp/servers/${server.id}`), ctx({ id: server.id }));
        expect(userRes.status).toBe(200);
        expect((await envelope<{ config: Record<string, unknown> }>(userRes)).data.config).toEqual({});

        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const adminRes = await serverGET(getReq(`/api/mcp/servers/${server.id}`), ctx({ id: server.id }));
        const adminData = (await envelope<{ config: { env?: Record<string, string> } }>(adminRes)).data;
        expect(adminData.config.env?.KEY).toBe("sekrit");
    });

    it("surfaces config_decryption_failed when the ciphertext can't be decrypted", async () => {
        const server = seedMcpServer({ config: { command: "echo", env: { TOKEN: "enc:v1:Z2FyYmFnZQ==" } } });
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await serverGET(getReq(`/api/mcp/servers/${server.id}`), ctx({ id: server.id }));
        const body = await envelope<{ config_decryption_failed?: boolean; config: { env?: Record<string, string> } }>(
            res,
        );
        expect(body.data.config_decryption_failed).toBe(true);
        expect(body.data.config.env?.TOKEN).toBe("");
    });

    it("400s changing transport without a matching config blob", async () => {
        const server = seedMcpServer({ transport: "stdio", config: { command: "echo" } });
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await serverPATCH(patchJson(`/api/mcp/servers/${server.id}`, { transport: "http" }), ctx({ id: server.id }));
        expect(res.status).toBe(400);
    });

    it("400s renaming to a name that already exists", async () => {
        seedMcpServer({ name: "taken" });
        const server = seedMcpServer({ name: "renameme" });
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await serverPATCH(patchJson(`/api/mcp/servers/${server.id}`, { name: "taken" }), ctx({ id: server.id }));
        expect(res.status).toBe(400);
    });

    it("updates fields as admin, bumping config_version only on transport/config edits", async () => {
        const server = seedMcpServer({ transport: "stdio", config: { command: "echo" }, configVersion: "v1" });
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));

        const renameRes = await serverPATCH(
            patchJson(`/api/mcp/servers/${server.id}`, { name: "renamed-server" }),
            ctx({ id: server.id }),
        );
        const renameBody = await envelope<{ name: string; config_version: string }>(renameRes);
        expect(renameBody.data.name).toBe("renamed-server");
        expect(renameBody.data.config_version).toBe("v1");

        mockCheckMcpServer.mockResolvedValue(null);
        const configRes = await serverPATCH(
            patchJson(`/api/mcp/servers/${server.id}`, { config: { command: "echo2" } }),
            ctx({ id: server.id }),
        );
        const configBody = await envelope<{ config_version: string }>(configRes);
        expect(configBody.data.config_version).not.toBe("v1");
        expect(mockCheckMcpServer).toHaveBeenCalled();
    });

    it("disposes the runtime client (no-op, unconnected) when disabling", async () => {
        const server = seedMcpServer({ enabled: true });
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await serverPATCH(patchJson(`/api/mcp/servers/${server.id}`, { enabled: false }), ctx({ id: server.id }));
        expect(res.status).toBe(200);
        expect((await envelope<{ enabled: boolean }>(res)).data.enabled).toBe(false);
    });

    it("deletes a server as admin", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await serverDELETE(getReq(`/api/mcp/servers/${server.id}`), ctx({ id: server.id }));
        expect(res.status).toBe(200);
        const getRes = await serverGET(getReq(`/api/mcp/servers/${server.id}`), ctx({ id: server.id }));
        expect(getRes.status).toBe(404);
    });
});

describe("POST /api/mcp/servers/[id]/check", () => {
    beforeEach(() => {
        resetDb();
        mockCheckMcpServer.mockReset();
        mockRunMcpCheck.mockReset();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await checkPOST(getReq("/api/mcp/servers/x/check", { method: "POST" }), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("403s a non-admin", async () => {
        const server = seedMcpServer();
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await checkPOST(getReq(`/api/mcp/servers/${server.id}/check`, { method: "POST" }), ctx({ id: server.id }));
        expect(res.status).toBe(403);
    });

    it("404s a nonexistent server", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await checkPOST(getReq("/api/mcp/servers/nope/check", { method: "POST" }), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("runs the plain-JSON check and returns the updated DTO", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockCheckMcpServer.mockResolvedValue({
            id: server.id,
            name: server.name,
            description: "",
            transport: "stdio",
            config: {},
            enabled: true,
            last_check_status: "ok",
            last_check_at: new Date().toISOString(),
            last_check_error: null,
            tools_cache: [],
            resources_cache: null,
            prompts_cache: null,
            server_info: null,
            config_version: "v1",
            created_at: server.createdAt,
            updated_at: server.updatedAt,
        });
        const res = await checkPOST(getReq(`/api/mcp/servers/${server.id}/check`, { method: "POST" }), ctx({ id: server.id }));
        expect(res.status).toBe(200);
        expect((await envelope<{ last_check_status: string }>(res)).data.last_check_status).toBe("ok");
    });

    it("404s when checkMcpServer returns null (concurrently deleted)", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockCheckMcpServer.mockResolvedValue(null);
        const res = await checkPOST(getReq(`/api/mcp/servers/${server.id}/check`, { method: "POST" }), ctx({ id: server.id }));
        expect(res.status).toBe(404);
    });

    it("streams SSE events when Accept: text/event-stream is requested", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockRunMcpCheck.mockImplementation(async (_id, send) => {
            send({ type: "phase", phase: "connecting" });
            send({ type: "result", server: { id: server.id } as never });
            return null;
        });
        const req = getReq(`/api/mcp/servers/${server.id}/check`, {
            method: "POST",
            headers: { accept: "text/event-stream" },
        });
        const res = await checkPOST(req, ctx({ id: server.id }));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        const text = await res.text();
        expect(text).toContain("event: phase");
        expect(text).toContain("event: result");
        expect(mockRunMcpCheck).toHaveBeenCalledWith(
            server.id,
            expect.any(Function),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it("aborts the inner signal when the SSE consumer cancels the stream (client disconnect)", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        let capturedSignal: AbortSignal | undefined;
        mockRunMcpCheck.mockImplementation(async (_id, _send, opts) => {
            capturedSignal = (opts as { signal?: AbortSignal } | undefined)?.signal;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return null;
        });
        const req = getReq(`/api/mcp/servers/${server.id}/check`, {
            method: "POST",
            headers: { accept: "text/event-stream" },
        });
        const res = await checkPOST(req, ctx({ id: server.id }));
        expect(res.body).toBeTruthy();
        await res.body!.cancel();
        expect(capturedSignal?.aborted).toBe(true);
    });
});

describe("POST /api/mcp/servers/[id]/restart", () => {
    beforeEach(() => {
        resetDb();
        mockCheckMcpServer.mockReset();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await restartPOST(getReq("/api/mcp/servers/x/restart", { method: "POST" }), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("403s a non-admin", async () => {
        const server = seedMcpServer();
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await restartPOST(
            getReq(`/api/mcp/servers/${server.id}/restart`, { method: "POST" }),
            ctx({ id: server.id }),
        );
        expect(res.status).toBe(403);
    });

    it("404s a nonexistent server", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await restartPOST(getReq("/api/mcp/servers/nope/restart", { method: "POST" }), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("disposes then re-checks, returning the fresh DTO", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockCheckMcpServer.mockResolvedValue({
            id: server.id,
            name: server.name,
            description: "",
            transport: "stdio",
            config: {},
            enabled: true,
            last_check_status: "ok",
            last_check_at: new Date().toISOString(),
            last_check_error: null,
            tools_cache: [],
            resources_cache: null,
            prompts_cache: null,
            server_info: null,
            config_version: "v1",
            created_at: server.createdAt,
            updated_at: server.updatedAt,
        });
        const res = await restartPOST(
            getReq(`/api/mcp/servers/${server.id}/restart`, { method: "POST" }),
            ctx({ id: server.id }),
        );
        expect(res.status).toBe(200);
        expect((await envelope<{ last_check_status: string }>(res)).data.last_check_status).toBe("ok");
    });

    it("404s when checkMcpServer returns null (concurrently deleted)", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockCheckMcpServer.mockResolvedValue(null);
        const res = await restartPOST(
            getReq(`/api/mcp/servers/${server.id}/restart`, { method: "POST" }),
            ctx({ id: server.id }),
        );
        expect(res.status).toBe(404);
    });
});

describe("GET /api/mcp/servers/[id]/runtime", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await runtimeGET(getReq("/api/mcp/servers/x/runtime"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("403s a non-admin", async () => {
        const server = seedMcpServer();
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await runtimeGET(getReq(`/api/mcp/servers/${server.id}/runtime`), ctx({ id: server.id }));
        expect(res.status).toBe(403);
    });

    it("404s a nonexistent server", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await runtimeGET(getReq("/api/mcp/servers/nope/runtime"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("400s an out-of-range log_lines", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await runtimeGET(
            getReq(`/api/mcp/servers/${server.id}/runtime?log_lines=100000`),
            ctx({ id: server.id }),
        );
        expect(res.status).toBe(400);
    });

    it("returns an idle status snapshot for a never-connected server", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await runtimeGET(getReq(`/api/mcp/servers/${server.id}/runtime`), ctx({ id: server.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ status: string; pid: number | null; recent_logs: string[] }>(res);
        expect(body.data.status).toBe("idle");
        expect(body.data.pid).toBeNull();
        expect(body.data.recent_logs).toEqual([]);
    });
});

describe("POST /api/mcp/servers/[id]/stop", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await stopPOST(getReq("/api/mcp/servers/x/stop", { method: "POST" }), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("403s a non-admin", async () => {
        const server = seedMcpServer();
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await stopPOST(getReq(`/api/mcp/servers/${server.id}/stop`, { method: "POST" }), ctx({ id: server.id }));
        expect(res.status).toBe(403);
    });

    it("404s a nonexistent server", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await stopPOST(getReq("/api/mcp/servers/nope/stop", { method: "POST" }), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("stops (disposes, no-op) and returns an idle snapshot", async () => {
        const server = seedMcpServer();
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await stopPOST(getReq(`/api/mcp/servers/${server.id}/stop`, { method: "POST" }), ctx({ id: server.id }));
        expect(res.status).toBe(200);
        expect((await envelope<{ status: string }>(res)).data.status).toBe("idle");
    });
});

describe("GET /api/mcp/servers/[id]/tools", () => {
    beforeEach(() => {
        resetDb();
        mockListToolsForServer.mockReset();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await toolsGET(getReq("/api/mcp/servers/x/tools"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("403s a non-admin (DoS-vector guard: spawns a real child process)", async () => {
        const server = seedMcpServer();
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await toolsGET(getReq(`/api/mcp/servers/${server.id}/tools`), ctx({ id: server.id }));
        expect(res.status).toBe(403);
        expect(mockListToolsForServer).not.toHaveBeenCalled();
    });

    it("404s a nonexistent server", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await toolsGET(getReq("/api/mcp/servers/nope/tools"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("lists tools with qualified names for an admin", async () => {
        const server = seedMcpServer({ name: "gh" });
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        mockListToolsForServer.mockResolvedValue([
            {
                qualifiedName: "gh__search",
                localName: "search",
                description: "search things",
                parameters: {},
                serverId: server.id,
                serverName: "gh",
            },
        ]);
        const res = await toolsGET(getReq(`/api/mcp/servers/${server.id}/tools`), ctx({ id: server.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ server_id: string; tools: { qualified_name: string; name: string }[] }>(res);
        expect(body.data.server_id).toBe(server.id);
        expect(body.data.tools[0]).toEqual({
            qualified_name: "gh__search",
            name: "search",
            description: "search things",
            parameters: {},
        });
    });
});

describe("GET /api/mcp/presets", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await presetsGET(getReq("/api/mcp/presets"));
        expect(res.status).toBe(401);
    });

    it("returns the preset catalogue to any authenticated user", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await presetsGET(getReq("/api/mcp/presets"));
        expect(res.status).toBe(200);
        const body = await envelope<{ id: string; transport: string }[]>(res);
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.data.every((p) => p.id && (p.transport === "stdio" || p.transport === "http"))).toBe(true);
    });
});
