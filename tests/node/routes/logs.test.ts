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

import { mkdirSync, writeFileSync } from "node:fs";
import { GET as logsGET } from "@/app/api/logs/generations/route";
import { GET as logGET } from "@/app/api/logs/generations/[id]/route";
import { GET as imageGET } from "@/app/api/logs/generations/[id]/images/[idx]/route";
import { artifactDir, artifactPath } from "@/lib/server/gateway/artifacts";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedAdmin, seedLog, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, envelope, getReq, toSessionUser } from "./_helpers";

describe("GET /api/logs/generations", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await logsGET(getReq("/api/logs/generations"));
        expect(res.status).toBe(401);
    });

    it("400s an invalid query", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await logsGET(getReq("/api/logs/generations?page_size=0"));
        expect(res.status).toBe(400);
    });

    it("scopes a regular user's list to their own logs, joining username", async () => {
        const userA = seedUser({ username: "log-a" });
        const userB = seedUser({ username: "log-b" });
        seedLog({ userId: userA.id, modelName: "model-a" });
        seedLog({ userId: userB.id, modelName: "model-b" });

        asUser(toSessionUser(userA));
        const res = await logsGET(getReq("/api/logs/generations"));
        expect(res.status).toBe(200);
        const body = await envelope<{ items: { model_name: string; username: string | null }[]; total: number }>(res);
        expect(body.data.total).toBe(1);
        expect(body.data.items[0].model_name).toBe("model-a");
        expect(body.data.items[0].username).toBe("log-a");
    });

    it("ignores a non-admin's user_id param (no cross-user leak)", async () => {
        const userA = seedUser({ username: "log-c" });
        const userB = seedUser({ username: "log-d" });
        seedLog({ userId: userA.id });
        seedLog({ userId: userB.id });
        asUser(toSessionUser(userA));
        const res = await logsGET(getReq(`/api/logs/generations?user_id=${userB.id}`));
        const body = await envelope<{ total: number }>(res);
        expect(body.data.total).toBe(1);
    });

    it("lets an admin see every user's logs, or scope via user_id/model_name/capability/status", async () => {
        const admin = seedAdmin();
        const userA = seedUser({ username: "log-e" });
        const userB = seedUser({ username: "log-f" });
        seedLog({ userId: userA.id, modelName: "gpt-4o", capability: "chat", status: "completed" });
        seedLog({ userId: userB.id, modelName: "dall-e-3", capability: "image", status: "failed" });
        asAdmin(toSessionUser(admin));

        const allRes = await logsGET(getReq("/api/logs/generations"));
        expect((await envelope<{ total: number }>(allRes)).data.total).toBe(2);

        const byUser = await logsGET(getReq(`/api/logs/generations?user_id=${userA.id}`));
        expect((await envelope<{ total: number }>(byUser)).data.total).toBe(1);

        const byModel = await logsGET(getReq("/api/logs/generations?model_name=dall-e"));
        expect((await envelope<{ total: number }>(byModel)).data.total).toBe(1);

        const byCapability = await logsGET(getReq("/api/logs/generations?capability=chat"));
        expect((await envelope<{ total: number }>(byCapability)).data.total).toBe(1);

        const byStatus = await logsGET(getReq("/api/logs/generations?status=failed"));
        expect((await envelope<{ total: number }>(byStatus)).data.total).toBe(1);
    });

    it("excludes soft-deleted logs", async () => {
        const user = seedUser();
        seedLog({ userId: user.id, isDeleted: true });
        asUser(toSessionUser(user));
        const res = await logsGET(getReq("/api/logs/generations"));
        expect((await envelope<{ total: number }>(res)).data.total).toBe(0);
    });
});

describe("GET /api/logs/generations/[id]", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await logGET(getReq("/api/logs/generations/x"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent log", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await logGET(getReq("/api/logs/generations/nope"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("403s a non-admin reading someone else's log", async () => {
        const owner = seedUser({ username: "log-owner" });
        const attacker = seedUser({ username: "log-attacker" });
        const log = seedLog({ userId: owner.id });
        asUser(toSessionUser(attacker));
        const res = await logGET(getReq(`/api/logs/generations/${log.id}`), ctx({ id: log.id }));
        expect(res.status).toBe(403);
    });

    it("allows an admin to read another user's log (admin bypass — unlike conversations)", async () => {
        const owner = seedUser({ username: "log-owner-2" });
        const admin = seedAdmin();
        const log = seedLog({ userId: owner.id, modelName: "gpt-4o" });
        asAdmin(toSessionUser(admin));
        const res = await logGET(getReq(`/api/logs/generations/${log.id}`), ctx({ id: log.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ model_name: string }>(res);
        expect(body.data.model_name).toBe("gpt-4o");
    });

    it("returns the full detail DTO for the owner, including input/generation_kwargs", async () => {
        const user = seedUser();
        const log = seedLog({ userId: user.id, input: { messages: [{ role: "user", content: "hi" }] } });
        asUser(toSessionUser(user));
        const res = await logGET(getReq(`/api/logs/generations/${log.id}`), ctx({ id: log.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ input: unknown; generation_kwargs: unknown }>(res);
        expect(body.data.input).toEqual({ messages: [{ role: "user", content: "hi" }] });
    });

    it("lazily migrates inline b64_json image data to a persisted artifact on first read", async () => {
        const user = seedUser();
        const b64 = Buffer.from("fake-png-bytes").toString("base64");
        const log = seedLog({
            userId: user.id,
            capability: "image",
            generation: { data: [{ b64_json: b64, revised_prompt: "a cat" }] },
        });
        asUser(toSessionUser(user));

        const res = await logGET(getReq(`/api/logs/generations/${log.id}`), ctx({ id: log.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ generation: { data: { b64_json?: string; url?: string; revised_prompt?: string }[] } }>(
            res,
        );
        expect(body.data.generation.data[0].b64_json).toBeUndefined();
        expect(body.data.generation.data[0].url).toBe(`/api/logs/generations/${log.id}/images/0`);
        expect(body.data.generation.data[0].revised_prompt).toBe("a cat");

        // Persisted to the DB row too, so subsequent reads don't re-migrate.
        const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, log.id)).get();
        const stored = row?.generation as { data: { b64_json?: string }[] } | null;
        expect(stored?.data[0].b64_json).toBeUndefined();
    });
});

describe("GET /api/logs/generations/[id]/images/[idx]", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await imageGET(getReq("/api/logs/generations/x/images/0"), ctx({ id: "x", idx: "0" }));
        expect(res.status).toBe(401);
    });

    it("404s when the log doesn't exist", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await imageGET(getReq("/api/logs/generations/nope/images/0"), ctx({ id: "nope", idx: "0" }));
        expect(res.status).toBe(404);
    });

    it("400s an out-of-range idx", async () => {
        const user = seedUser();
        const log = seedLog({ userId: user.id });
        asUser(toSessionUser(user));
        const res = await imageGET(
            getReq(`/api/logs/generations/${log.id}/images/999`),
            ctx({ id: log.id, idx: "999" }),
        );
        expect(res.status).toBe(400);
    });

    it("403s a non-admin reading another user's artifact", async () => {
        const owner = seedUser({ username: "img-owner" });
        const attacker = seedUser({ username: "img-attacker" });
        const log = seedLog({ userId: owner.id });
        asUser(toSessionUser(attacker));
        const res = await imageGET(getReq(`/api/logs/generations/${log.id}/images/0`), ctx({ id: log.id, idx: "0" }));
        expect(res.status).toBe(403);
    });

    it("404s when the log exists but no artifact file was ever written", async () => {
        const user = seedUser();
        const log = seedLog({ userId: user.id });
        asUser(toSessionUser(user));
        const res = await imageGET(getReq(`/api/logs/generations/${log.id}/images/0`), ctx({ id: log.id, idx: "0" }));
        expect(res.status).toBe(404);
    });

    it("serves a persisted artifact with the right content-type for the owner", async () => {
        const user = seedUser();
        const log = seedLog({ userId: user.id });
        mkdirSync(artifactDir(log.id), { recursive: true });
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
        writeFileSync(artifactPath(log.id, 0, "png"), bytes);
        asUser(toSessionUser(user));

        const res = await imageGET(getReq(`/api/logs/generations/${log.id}/images/0`), ctx({ id: log.id, idx: "0" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        const buf = Buffer.from(await res.arrayBuffer());
        expect(buf.equals(bytes)).toBe(true);
    });

    it("allows an admin to read another user's artifact", async () => {
        const owner = seedUser({ username: "img-owner-2" });
        const admin = seedAdmin();
        const log = seedLog({ userId: owner.id });
        mkdirSync(artifactDir(log.id), { recursive: true });
        writeFileSync(artifactPath(log.id, 0, "jpg"), Buffer.from([0xff, 0xd8, 0xff]));
        asAdmin(toSessionUser(admin));

        const res = await imageGET(getReq(`/api/logs/generations/${log.id}/images/0`), ctx({ id: log.id, idx: "0" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/jpeg");
    });
});
