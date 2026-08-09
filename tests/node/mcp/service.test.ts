import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedMcpServer } from "../../helpers/db";

vi.mock("@/lib/server/mcp/checks", () => ({
    checkMcpServer: vi.fn(async () => undefined),
}));
vi.mock("@/lib/server/mcp/runtime", () => ({
    disposeMcpClient: vi.fn(async () => undefined),
    forgetMcpServer: vi.fn(() => undefined),
}));

import { checkMcpServer } from "@/lib/server/mcp/checks";
import { disposeMcpClient, forgetMcpServer } from "@/lib/server/mcp/runtime";
import { appendMcpLog, readMcpLog } from "@/lib/server/mcp/logs";
import {
    createMcpServer,
    deleteMcpServer,
    getMcpServer,
    listMcpServers,
    updateMcpServer,
} from "@/lib/server/mcp/service";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";

const checkMock = vi.mocked(checkMcpServer);
const disposeMock = vi.mocked(disposeMcpClient);
const forgetMock = vi.mocked(forgetMcpServer);

beforeEach(() => {
    resetDb();
    checkMock.mockClear();
    disposeMock.mockClear();
    forgetMock.mockClear();
    checkMock.mockResolvedValue(null);
    disposeMock.mockResolvedValue(undefined);
});

function countRows(): number {
    return db.select().from(schema.mcpServers).all().length;
}

describe("listMcpServers", () => {
    it("returns an empty array with no rows", () => {
        expect(listMcpServers()).toEqual([]);
    });

    it("returns all rows ordered by name", () => {
        seedMcpServer({ name: "zeta" });
        seedMcpServer({ name: "alpha" });
        seedMcpServer({ name: "mid" });
        const names = listMcpServers().map((s) => s.name);
        expect(names).toEqual(["alpha", "mid", "zeta"]);
    });

    it("redacts config when redactSecrets is requested", () => {
        seedMcpServer({ name: "srv", config: { command: "echo", args: ["hi"], env: { A: "b" } } });
        const [dto] = listMcpServers({ redactSecrets: true });
        expect(dto.config).toEqual({});
    });
});

describe("getMcpServer", () => {
    it("throws notFound for an unknown id/name", () => {
        expect(() => getMcpServer("does-not-exist")).toThrow(/not found/i);
    });

    it("looks up by id", () => {
        const s = seedMcpServer({ name: "by-id" });
        expect(getMcpServer(s.id).id).toBe(s.id);
    });

    it("looks up by name when the id doesn't match", () => {
        const s = seedMcpServer({ name: "by-name" });
        expect(getMcpServer("by-name").id).toBe(s.id);
    });
});

describe("createMcpServer", () => {
    it("creates a stdio server, defaults enabled=true and description='', and schedules a check", () => {
        const dto = createMcpServer({
            name: "my-server",
            transport: "stdio",
            config: { command: "npx", args: ["-y", "server"] },
        });
        expect(dto.name).toBe("my-server");
        expect(dto.enabled).toBe(true);
        expect(dto.description).toBe("");
        expect(dto.config_version).toBeTruthy();
        expect(checkMock).toHaveBeenCalledWith(dto.id, undefined);
    });

    it("passes opts.connectTimeoutMs through to the scheduled check", () => {
        const dto = createMcpServer(
            { name: "srv-timeout", transport: "stdio", config: { command: "echo" } },
            { connectTimeoutMs: 12_345 },
        );
        expect(checkMock).toHaveBeenCalledWith(dto.id, 12_345);
    });

    it("respects an explicit enabled=false and still schedules a check", () => {
        const dto = createMcpServer({
            name: "disabled-at-birth",
            transport: "stdio",
            config: { command: "echo" },
            enabled: false,
        });
        expect(dto.enabled).toBe(false);
        expect(checkMock).toHaveBeenCalledWith(dto.id, undefined);
    });

    it("round-trips an encrypted stdio env secret transparently through create+read", () => {
        const dto = createMcpServer({
            name: "secret-stdio",
            transport: "stdio",
            config: { command: "npx", env: { TOKEN: "super-secret" } },
        });
        // At-rest row must not carry the plaintext secret.
        const row = db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, dto.id)).get();
        const rawEnv = (row?.config as { env?: Record<string, string> }).env;
        expect(rawEnv?.TOKEN).not.toBe("super-secret");
        expect(rawEnv?.TOKEN).toMatch(/^enc:/);
        // Read path decrypts it back.
        expect(getMcpServer(dto.id).config.env).toEqual({ TOKEN: "super-secret" });
    });

    it("round-trips an encrypted http header secret transparently through create+read", () => {
        const dto = createMcpServer({
            name: "secret-http",
            transport: "http",
            config: { url: "https://example.com/mcp", headers: { Authorization: "Bearer xyz" } },
        });
        const row = db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, dto.id)).get();
        const rawHeaders = (row?.config as { headers?: Record<string, string> }).headers;
        expect(rawHeaders?.Authorization).toMatch(/^enc:/);
        expect(getMcpServer(dto.id).config.headers).toEqual({ Authorization: "Bearer xyz" });
    });

    it("rejects an exact duplicate name and leaves the table unchanged", () => {
        seedMcpServer({ name: "dup" });
        expect(countRows()).toBe(1);
        expect(() =>
            createMcpServer({ name: "dup", transport: "stdio", config: { command: "echo" } }),
        ).toThrow(/already exists/i);
        expect(countRows()).toBe(1);
    });

    it("rejects a name that sanitizes to start with an underscore", () => {
        expect(() =>
            createMcpServer({ name: "!leading", transport: "stdio", config: { command: "echo" } }),
        ).toThrow(/starts with "_"/);
        expect(countRows()).toBe(0);
    });

    it("rejects a name that sanitizes to contain a double underscore", () => {
        expect(() =>
            createMcpServer({ name: "foo  bar", transport: "stdio", config: { command: "echo" } }),
        ).toThrow(/contains "__"/);
        expect(countRows()).toBe(0);
    });

    it("rejects a name whose sanitized prefix collides with an existing (differently-spelled) server", () => {
        seedMcpServer({ name: "foo bar" }); // sanitizes to "foo_bar"
        expect(() =>
            createMcpServer({ name: "foo_bar", transport: "stdio", config: { command: "echo" } }),
        ).toThrow(/conflicts with "foo bar"/);
        expect(countRows()).toBe(1);
    });

    it("succeeds when existing servers have distinct sanitized prefixes (collision loop falls through cleanly)", () => {
        seedMcpServer({ name: "existing-one" });
        seedMcpServer({ name: "existing-two" });
        const dto = createMcpServer({ name: "brand-new", transport: "stdio", config: { command: "echo" } });
        expect(dto.name).toBe("brand-new");
        expect(countRows()).toBe(3);
    });

    it("swallows a rejected scheduled check without throwing or leaving it unhandled", async () => {
        checkMock.mockRejectedValueOnce(new Error("network down"));
        expect(() =>
            createMcpServer({ name: "check-fails", transport: "stdio", config: { command: "echo" } }),
        ).not.toThrow();
        await vi.waitFor(() => expect(checkMock).toHaveBeenCalled());
    });
});

describe("updateMcpServer", () => {
    it("throws notFound for an unknown id/name", () => {
        expect(() => updateMcpServer("nope", { name: "x" })).toThrow(/not found/i);
    });

    it("renaming only: leaves configVersion unchanged and does not schedule a check", () => {
        const s = seedMcpServer({ name: "old-name", configVersion: "v1" });
        const dto = updateMcpServer(s.id, { name: "new-name" });
        expect(dto.name).toBe("new-name");
        expect(dto.config_version).toBe("v1");
        expect(checkMock).not.toHaveBeenCalled();
        expect(disposeMock).not.toHaveBeenCalled();
    });

    it("editing description only: leaves configVersion unchanged and does not schedule a check", () => {
        const s = seedMcpServer({ description: "old", configVersion: "v1" });
        const dto = updateMcpServer(s.id, { description: "new description" });
        expect(dto.description).toBe("new description");
        expect(dto.config_version).toBe("v1");
        expect(checkMock).not.toHaveBeenCalled();
    });

    it("changing config bumps configVersion, clears caches/check fields, and schedules a check", () => {
        const s = seedMcpServer({
            configVersion: "v1",
            toolsCache: [{ name: "t", parameters: {} }],
            resourcesCache: { resources: [], templates: [] },
            promptsCache: [],
            lastCheckStatus: "ok",
            lastCheckAt: new Date().toISOString(),
            lastCheckError: null,
        });
        const dto = updateMcpServer(s.id, { config: { command: "echo", args: ["changed"] } });
        expect(dto.config_version).not.toBe("v1");
        expect(dto.tools_cache).toBeNull();
        expect(dto.resources_cache).toBeNull();
        expect(dto.prompts_cache).toBeNull();
        expect(dto.last_check_status).toBeNull();
        expect(dto.last_check_at).toBeNull();
        expect(dto.last_check_error).toBeNull();
        expect(checkMock).toHaveBeenCalledWith(s.id, undefined);
    });

    it("changing transport without a matching config throws before touching the row", () => {
        const s = seedMcpServer({ transport: "stdio", configVersion: "v1" });
        expect(() => updateMcpServer(s.id, { transport: "http" })).toThrow(/matching config blob/);
        const row = db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, s.id)).get();
        expect(row?.transport).toBe("stdio");
        expect(row?.configVersion).toBe("v1");
        expect(checkMock).not.toHaveBeenCalled();
    });

    it("changing transport with a matching config bumps configVersion and schedules a check", () => {
        const s = seedMcpServer({ transport: "stdio", configVersion: "v1" });
        const dto = updateMcpServer(s.id, {
            transport: "http",
            config: { url: "https://example.com/mcp" },
        });
        expect(dto.transport).toBe("http");
        expect(dto.config_version).not.toBe("v1");
        expect(checkMock).toHaveBeenCalledWith(s.id, undefined);
    });

    it("disabling a currently-enabled server disposes the live client and does not schedule a check", () => {
        const s = seedMcpServer({ enabled: true, configVersion: "v1" });
        const dto = updateMcpServer(s.id, { enabled: false });
        expect(dto.enabled).toBe(false);
        expect(disposeMock).toHaveBeenCalledWith(s.id);
        expect(checkMock).not.toHaveBeenCalled();
    });

    it("disabling a server whose disposeMcpClient rejects still completes the update without throwing", async () => {
        disposeMock.mockRejectedValueOnce(new Error("stuck child process"));
        const s = seedMcpServer({ enabled: true });
        expect(() => updateMcpServer(s.id, { enabled: false })).not.toThrow();
        await vi.waitFor(() => expect(disposeMock).toHaveBeenCalledWith(s.id));
    });

    it("re-enabling a currently-disabled server schedules a check and does not dispose", () => {
        const s = seedMcpServer({ enabled: false, configVersion: "v1" });
        const dto = updateMcpServer(s.id, { enabled: true });
        expect(dto.enabled).toBe(true);
        expect(checkMock).toHaveBeenCalledWith(s.id, undefined);
        expect(disposeMock).not.toHaveBeenCalled();
    });

    it("resending enabled=true on an already-enabled server is a no-op (no dispose, no check)", () => {
        const s = seedMcpServer({ enabled: true });
        updateMcpServer(s.id, { enabled: true });
        expect(checkMock).not.toHaveBeenCalled();
        expect(disposeMock).not.toHaveBeenCalled();
    });

    it("resending enabled=false on an already-disabled server is a no-op (no dispose, no check)", () => {
        const s = seedMcpServer({ enabled: false });
        updateMcpServer(s.id, { enabled: false });
        expect(checkMock).not.toHaveBeenCalled();
        expect(disposeMock).not.toHaveBeenCalled();
    });

    it("flipping enabled AND changing config in the same patch schedules exactly one check", () => {
        const s = seedMcpServer({ enabled: false, configVersion: "v1" });
        updateMcpServer(s.id, { enabled: true, config: { command: "echo", args: ["x"] } });
        expect(checkMock).toHaveBeenCalledTimes(1);
        expect(disposeMock).not.toHaveBeenCalled();
    });

    it("rejects renaming to an empty (whitespace-only) name", () => {
        const s = seedMcpServer({ name: "keep-me" });
        expect(() => updateMcpServer(s.id, { name: "   " })).toThrow(/cannot be empty/);
    });

    it("rejects renaming to a name that already belongs to another server", () => {
        seedMcpServer({ name: "taken" });
        const s = seedMcpServer({ name: "mine" });
        expect(() => updateMcpServer(s.id, { name: "taken" })).toThrow(/already exists/i);
    });

    it("rejects renaming to a name whose sanitized prefix collides with a DIFFERENT server", () => {
        seedMcpServer({ name: "foo bar" }); // -> "foo_bar"
        const s = seedMcpServer({ name: "other" });
        expect(() => updateMcpServer(s.id, { name: "foo_bar" })).toThrow(/conflicts with "foo bar"/);
    });

    it("allows renaming to a DIFFERENT literal name that sanitizes to the SAME prefix as itself (self-exclusion)", () => {
        // "Alpha!One" and "Alpha One" both sanitize to "Alpha_One" — only one
        // non-alnum separator character, so no double-underscore rejection.
        const s = seedMcpServer({ name: "Alpha!One" });
        const dto = updateMcpServer(s.id, { name: "Alpha One" });
        expect(dto.name).toBe("Alpha One");
    });

    it("no-op rename to the exact same name does not touch configVersion or schedule a check", () => {
        const s = seedMcpServer({ name: "steady", configVersion: "v1" });
        const dto = updateMcpServer(s.id, { name: "steady" });
        expect(dto.config_version).toBe("v1");
        expect(checkMock).not.toHaveBeenCalled();
    });
});

describe("deleteMcpServer", () => {
    it("throws notFound for an unknown id/name", () => {
        expect(() => deleteMcpServer("nope")).toThrow(/not found/i);
    });

    it("removes the row, disposes the client, forgets it, and wipes its logs", async () => {
        const s = seedMcpServer({ name: "doomed" });
        appendMcpLog(s.id, "lifecycle", "some history");
        expect(readMcpLog(s.id)).toHaveLength(1);

        deleteMcpServer(s.id);

        expect(() => getMcpServer(s.id)).toThrow(/not found/i);
        expect(disposeMock).toHaveBeenCalledWith(s.id);
        await vi.waitFor(() => expect(forgetMock).toHaveBeenCalledWith(s.id));
        expect(readMcpLog(s.id)).toEqual([]);
    });

    it("still forgets and cleans up logs even when dispose rejects", async () => {
        disposeMock.mockRejectedValueOnce(new Error("boom"));
        const s = seedMcpServer({ name: "flaky-dispose" });
        deleteMcpServer(s.id);
        await vi.waitFor(() => expect(forgetMock).toHaveBeenCalledWith(s.id));
    });
});
