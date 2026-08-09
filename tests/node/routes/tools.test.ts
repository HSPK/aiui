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

import { GET as toolsGET, POST as toolsPOST } from "@/app/api/tools/route";
import { DELETE as toolDELETE, GET as toolGET, PATCH as toolPATCH } from "@/app/api/tools/[id]/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedAdmin, seedTool, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, deleteReq, envelope, getReq, patchJson, postJson, toSessionUser } from "./_helpers";

describe("GET/POST /api/tools", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers on GET", async () => {
        asAnon();
        const res = await toolsGET(getReq("/api/tools"));
        expect(res.status).toBe(401);
    });

    it("lists tools for any logged-in user (not admin-gated)", async () => {
        const user = seedUser();
        seedTool({ name: "search_web" });
        asUser(toSessionUser(user));
        const res = await toolsGET(getReq("/api/tools"));
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string }[]>(res);
        expect(body.data.map((t) => t.name)).toEqual(["search_web"]);
    });

    it("401s POST for anonymous, 403s for a non-admin", async () => {
        asAnon();
        expect((await toolsPOST(postJson("/api/tools", { name: "x" }))).status).toBe(401);
        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await toolsPOST(postJson("/api/tools", { name: "x" }))).status).toBe(403);
    });

    it("400s an invalid name (disallowed characters)", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await toolsPOST(postJson("/api/tools", { name: "bad name!" }));
        expect(res.status).toBe(400);
    });

    it("400s an invalid webhook_url", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await toolsPOST(postJson("/api/tools", { name: "good_name", webhook_url: "not-a-url" }));
        expect(res.status).toBe(400);
    });

    it("creates a tool as admin with sane defaults", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await toolsPOST(postJson("/api/tools", { name: "my_tool" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string; description: string; enabled: boolean; parameters: unknown }>(res);
        expect(body.data.name).toBe("my_tool");
        expect(body.data.description).toBe("");
        expect(body.data.enabled).toBe(true);
        expect(body.data.parameters).toEqual({});
    });

    it("400s creating a duplicate tool name", async () => {
        const admin = seedAdmin();
        seedTool({ name: "dupe_tool" });
        asAdmin(toSessionUser(admin));
        const res = await toolsPOST(postJson("/api/tools", { name: "dupe_tool" }));
        expect(res.status).toBe(400);
    });
});

describe("GET/PATCH/DELETE /api/tools/[id]", () => {
    beforeEach(() => resetDb());

    it("401s anonymous GET", async () => {
        asAnon();
        const res = await toolGET(getReq("/api/tools/x"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent tool", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await toolGET(getReq("/api/tools/nope"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("gets a tool by id or name", async () => {
        const user = seedUser();
        const tool = seedTool({ name: "gettable" });
        asUser(toSessionUser(user));
        expect((await toolGET(getReq(`/api/tools/${tool.id}`), ctx({ id: tool.id }))).status).toBe(200);
        expect((await toolGET(getReq("/api/tools/gettable"), ctx({ id: "gettable" }))).status).toBe(200);
    });

    it("401s/403s PATCH and DELETE for anonymous/non-admin", async () => {
        const tool = seedTool();
        asAnon();
        expect((await toolPATCH(patchJson(`/api/tools/${tool.id}`, {}), ctx({ id: tool.id }))).status).toBe(401);
        expect((await toolDELETE(deleteReq(`/api/tools/${tool.id}`), ctx({ id: tool.id }))).status).toBe(401);

        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await toolPATCH(patchJson(`/api/tools/${tool.id}`, {}), ctx({ id: tool.id }))).status).toBe(403);
        expect((await toolDELETE(deleteReq(`/api/tools/${tool.id}`), ctx({ id: tool.id }))).status).toBe(403);
    });

    it("404s updating/deleting a nonexistent tool", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        expect((await toolPATCH(patchJson("/api/tools/nope", { enabled: false }), ctx({ id: "nope" }))).status).toBe(404);
        expect((await toolDELETE(deleteReq("/api/tools/nope"), ctx({ id: "nope" }))).status).toBe(404);
    });

    it("400s renaming to an empty name or one already taken", async () => {
        const admin = seedAdmin();
        seedTool({ name: "taken_tool" });
        const tool = seedTool({ name: "renameable" });
        asAdmin(toSessionUser(admin));

        expect((await toolPATCH(patchJson(`/api/tools/${tool.id}`, { name: "   " }), ctx({ id: tool.id }))).status).toBe(400);
        expect((await toolPATCH(patchJson(`/api/tools/${tool.id}`, { name: "taken_tool" }), ctx({ id: tool.id }))).status).toBe(400);
    });

    it("updates a tool's enabled flag and webhook_url", async () => {
        const admin = seedAdmin();
        const tool = seedTool({ enabled: true });
        asAdmin(toSessionUser(admin));
        const res = await toolPATCH(
            patchJson(`/api/tools/${tool.id}`, { enabled: false, webhook_url: "https://hooks.example.com/tool" }),
            ctx({ id: tool.id }),
        );
        expect(res.status).toBe(200);
        const row = db.select().from(schema.tools).where(eq(schema.tools.id, tool.id)).get();
        expect(row?.enabled).toBe(false);
        expect(row?.webhookUrl).toBe("https://hooks.example.com/tool");
    });

    it("deletes a tool", async () => {
        const admin = seedAdmin();
        const tool = seedTool();
        asAdmin(toSessionUser(admin));
        const res = await toolDELETE(deleteReq(`/api/tools/${tool.id}`), ctx({ id: tool.id }));
        expect(res.status).toBe(200);
        const row = db.select().from(schema.tools).where(eq(schema.tools.id, tool.id)).get();
        expect(row).toBeUndefined();
    });
});
