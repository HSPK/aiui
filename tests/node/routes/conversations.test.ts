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

import { GET as convListGET } from "@/app/api/conversations/route";
import { DELETE as convDELETE, PATCH as convPATCH } from "@/app/api/conversations/[id]/route";
import { GET as messagesGET } from "@/app/api/conversations/[id]/messages/route";
import { POST as ratePOST } from "@/app/api/messages/[id]/rate/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedConversation, seedMessage, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, deleteReq, envelope, getReq, patchJson, postJson, toSessionUser } from "./_helpers";

describe("GET /api/conversations", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await convListGET(getReq("/api/conversations"));
        expect(res.status).toBe(401);
    });

    it("400s an invalid query", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await convListGET(getReq("/api/conversations?page_size=0"));
        expect(res.status).toBe(400);
    });

    it("lists only the caller's own, non-deleted conversations", async () => {
        const userA = seedUser({ username: "conv-a" });
        const userB = seedUser({ username: "conv-b" });
        seedConversation({ userId: userA.id, title: "A1" });
        seedConversation({ userId: userA.id, title: "A2", isDeleted: true });
        seedConversation({ userId: userB.id, title: "B1" });

        asUser(toSessionUser(userA));
        const res = await convListGET(getReq("/api/conversations"));
        expect(res.status).toBe(200);
        const body = await envelope<{ items: { title: string }[]; total: number }>(res);
        expect(body.data.total).toBe(1);
        expect(body.data.items[0].title).toBe("A1");
    });

    it("filters by keyword", async () => {
        const user = seedUser();
        seedConversation({ userId: user.id, title: "Talk about cats" });
        seedConversation({ userId: user.id, title: "Talk about dogs" });
        asUser(toSessionUser(user));

        const res = await convListGET(getReq("/api/conversations?keyword=cats"));
        const body = await envelope<{ items: { title: string }[] }>(res);
        expect(body.data.items).toHaveLength(1);
        expect(body.data.items[0].title).toBe("Talk about cats");
    });
});

describe("PATCH/DELETE /api/conversations/[id]", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const patchRes = await convPATCH(patchJson("/api/conversations/x", { title: "y" }), ctx({ id: "x" }));
        expect(patchRes.status).toBe(401);
        const deleteRes = await convDELETE(deleteReq("/api/conversations/x"), ctx({ id: "x" }));
        expect(deleteRes.status).toBe(401);
    });

    it("404s a nonexistent conversation", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await convPATCH(patchJson("/api/conversations/nope", { title: "y" }), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("400s an invalid PATCH body (empty title)", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        asUser(toSessionUser(user));
        const res = await convPATCH(patchJson(`/api/conversations/${conv.id}`, { title: "" }), ctx({ id: conv.id }));
        expect(res.status).toBe(400);
    });

    it("renames the caller's own conversation", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id, title: "old" });
        asUser(toSessionUser(user));
        const res = await convPATCH(
            patchJson(`/api/conversations/${conv.id}`, { title: "new title" }),
            ctx({ id: conv.id }),
        );
        expect(res.status).toBe(200);
        const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get();
        expect(row?.title).toBe("new title");
    });

    it("silently no-ops a rename when expected_title mismatches (compare-and-swap)", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id, title: "current" });
        asUser(toSessionUser(user));
        const res = await convPATCH(
            patchJson(`/api/conversations/${conv.id}`, { title: "background-update", expected_title: "stale" }),
            ctx({ id: conv.id }),
        );
        expect(res.status).toBe(200);
        const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get();
        expect(row?.title).toBe("current");
    });

    it("applies the rename when expected_title matches", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id, title: "current" });
        asUser(toSessionUser(user));
        const res = await convPATCH(
            patchJson(`/api/conversations/${conv.id}`, { title: "renamed", expected_title: "current" }),
            ctx({ id: conv.id }),
        );
        expect(res.status).toBe(200);
        const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get();
        expect(row?.title).toBe("renamed");
    });

    it("403s renaming/deleting someone else's conversation (no cross-user access)", async () => {
        const owner = seedUser({ username: "conv-owner" });
        const attacker = seedUser({ username: "conv-attacker" });
        const conv = seedConversation({ userId: owner.id, title: "private" });
        asUser(toSessionUser(attacker));

        const patchRes = await convPATCH(
            patchJson(`/api/conversations/${conv.id}`, { title: "hacked" }),
            ctx({ id: conv.id }),
        );
        expect(patchRes.status).toBe(403);
        const deleteRes = await convDELETE(deleteReq(`/api/conversations/${conv.id}`), ctx({ id: conv.id }));
        expect(deleteRes.status).toBe(403);
    });

    it(
        "KNOWN DESIGN POINT: an admin cannot read/rename/delete another user's conversation either " +
            "(unlike generation logs, which do allow an admin bypass — see logs.test.ts). Locking this in " +
            "so a future change doesn't accidentally introduce a bypass without an explicit decision.",
        async () => {
            const owner = seedUser({ username: "conv-owner-2" });
            const admin = seedAdminForConversationTest();
            const conv = seedConversation({ userId: owner.id, title: "private-2" });
            asAdmin(toSessionUser(admin));

            const res = await convPATCH(
                patchJson(`/api/conversations/${conv.id}`, { title: "admin-cannot-touch" }),
                ctx({ id: conv.id }),
            );
            expect(res.status).toBe(403);
        },
    );

    it("soft-deletes: row remains but is_deleted flips and it drops from listing", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        asUser(toSessionUser(user));

        const res = await convDELETE(deleteReq(`/api/conversations/${conv.id}`), ctx({ id: conv.id }));
        expect(res.status).toBe(200);

        const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get();
        expect(row?.isDeleted).toBe(true);

        const listRes = await convListGET(getReq("/api/conversations"));
        const body = await envelope<{ total: number }>(listRes);
        expect(body.data.total).toBe(0);
    });
});

describe("GET /api/conversations/[id]/messages", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await messagesGET(getReq("/api/conversations/x/messages"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent conversation", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await messagesGET(getReq("/api/conversations/nope/messages"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("403s reading messages from someone else's conversation", async () => {
        const owner = seedUser({ username: "msg-owner" });
        const attacker = seedUser({ username: "msg-attacker" });
        const conv = seedConversation({ userId: owner.id });
        asUser(toSessionUser(attacker));
        const res = await messagesGET(getReq(`/api/conversations/${conv.id}/messages`), ctx({ id: conv.id }));
        expect(res.status).toBe(403);
    });

    it("400s an invalid query", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        asUser(toSessionUser(user));
        const res = await messagesGET(
            getReq(`/api/conversations/${conv.id}/messages?page_size=0`),
            ctx({ id: conv.id }),
        );
        expect(res.status).toBe(400);
    });

    it("lists active messages for the owner, newest first by default", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        seedMessage({ conversationId: conv.id, role: "user", content: "hi", createdAt: "2024-01-01T00:00:00.000Z" });
        seedMessage({
            conversationId: conv.id,
            role: "assistant",
            content: "hello!",
            createdAt: "2024-01-01T00:01:00.000Z",
        });
        seedMessage({
            conversationId: conv.id,
            role: "user",
            content: "inactive",
            isActive: false,
            createdAt: "2024-01-01T00:02:00.000Z",
        });

        asUser(toSessionUser(user));
        const res = await messagesGET(getReq(`/api/conversations/${conv.id}/messages`), ctx({ id: conv.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ items: { content: unknown }[]; total: number }>(res);
        expect(body.data.total).toBe(2);
        expect(body.data.items[0].content).toBe("hello!");
        expect(body.data.items[1].content).toBe("hi");
    });

    it("pulls in ancestor rows so a paginated tool response can bind to its parent", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        const userMsg = seedMessage({
            conversationId: conv.id,
            role: "user",
            content: "call a tool",
            createdAt: "2024-01-01T00:00:00.000Z",
        });
        const assistantMsg = seedMessage({
            conversationId: conv.id,
            role: "assistant",
            content: "calling...",
            parentId: userMsg.id,
            createdAt: "2024-01-01T00:01:00.000Z",
        });
        seedMessage({
            conversationId: conv.id,
            role: "tool",
            content: "tool result",
            parentId: assistantMsg.id,
            createdAt: "2024-01-01T00:02:00.000Z",
        });

        asUser(toSessionUser(user));
        // page_size=1 with sort=-created_at only directly loads the newest
        // (tool) row; the assistant parent must be pulled in as an ancestor.
        const res = await messagesGET(
            getReq(`/api/conversations/${conv.id}/messages?page_size=1&sort=-created_at`),
            ctx({ id: conv.id }),
        );
        expect(res.status).toBe(200);
        const body = await envelope<{ items: { role: string }[] }>(res);
        const roles = body.data.items.map((m) => m.role);
        expect(roles).toContain("tool");
        expect(roles).toContain("assistant");
    });
});

describe("POST /api/messages/[id]/rate", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await ratePOST(postJson("/api/messages/x/rate", { rating: "up" }), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent message", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await ratePOST(postJson("/api/messages/nope/rate", { rating: "up" }), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("400s an invalid rating value", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        const msg = seedMessage({ conversationId: conv.id });
        asUser(toSessionUser(user));
        const res = await ratePOST(postJson(`/api/messages/${msg.id}/rate`, { rating: "sideways" }), ctx({ id: msg.id }));
        expect(res.status).toBe(400);
    });

    it("403s rating a message in someone else's conversation", async () => {
        const owner = seedUser({ username: "rate-owner" });
        const attacker = seedUser({ username: "rate-attacker" });
        const conv = seedConversation({ userId: owner.id });
        const msg = seedMessage({ conversationId: conv.id });
        asUser(toSessionUser(attacker));
        const res = await ratePOST(postJson(`/api/messages/${msg.id}/rate`, { rating: "up" }), ctx({ id: msg.id }));
        expect(res.status).toBe(403);
    });

    it("rates the message up, then clears it via 'none'", async () => {
        const user = seedUser();
        const conv = seedConversation({ userId: user.id });
        const msg = seedMessage({ conversationId: conv.id });
        asUser(toSessionUser(user));

        const upRes = await ratePOST(
            postJson(`/api/messages/${msg.id}/rate`, { rating: "up", feedback: "great" }),
            ctx({ id: msg.id }),
        );
        expect(upRes.status).toBe(200);
        let row = db.select().from(schema.messages).where(eq(schema.messages.id, msg.id)).get();
        expect(row?.rating).toBe("up");
        expect(row?.feedback).toBe("great");

        const noneRes = await ratePOST(postJson(`/api/messages/${msg.id}/rate`, { rating: "none" }), ctx({ id: msg.id }));
        expect(noneRes.status).toBe(200);
        row = db.select().from(schema.messages).where(eq(schema.messages.id, msg.id)).get();
        expect(row?.rating).toBeNull();
    });
});

function seedAdminForConversationTest() {
    return seedUser({ username: "conv-admin", role: "admin" });
}
