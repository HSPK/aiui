import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { HttpError } from "@/lib/server/response";
import { listConversations, softDeleteConversation, updateConversationTitle } from "@/lib/server/conversations";
import { resetDb, seedConversation, seedUser } from "../../helpers/db";

describe("conversations service", () => {
    beforeEach(() => resetDb());

    describe("listConversations", () => {
        it("returns an empty page when the user has no conversations", () => {
            const user = seedUser({ username: "empty-user" });
            const result = listConversations(user.id, { page: 1, page_size: 20, sort: "-updated_at" });
            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });

        it("only returns conversations owned by the requesting user", () => {
            const alice = seedUser({ username: "alice" });
            const bob = seedUser({ username: "bob" });
            seedConversation({ userId: alice.id, title: "alice-conv" });
            seedConversation({ userId: bob.id, title: "bob-conv" });

            const aliceResult = listConversations(alice.id, { page: 1, page_size: 20, sort: "-updated_at" });
            expect(aliceResult.items).toHaveLength(1);
            expect(aliceResult.items[0].title).toBe("alice-conv");
        });

        it("excludes soft-deleted conversations", () => {
            const user = seedUser({ username: "deleter" });
            seedConversation({ userId: user.id, title: "alive" });
            seedConversation({ userId: user.id, title: "dead", isDeleted: true });

            const result = listConversations(user.id, { page: 1, page_size: 20, sort: "-updated_at" });
            expect(result.items.map((c) => c.title)).toEqual(["alive"]);
            expect(result.total).toBe(1);
        });

        it("filters by keyword against the title", () => {
            const user = seedUser({ username: "searcher" });
            seedConversation({ userId: user.id, title: "Trip to Japan" });
            seedConversation({ userId: user.id, title: "Grocery list" });
            seedConversation({ userId: user.id, title: "Japan visa notes" });

            const result = listConversations(user.id, { page: 1, page_size: 20, sort: "-updated_at", keyword: "Japan" });
            expect(result.items.map((c) => c.title).sort()).toEqual(["Japan visa notes", "Trip to Japan"]);
        });

        it("orders by updated_at descending", () => {
            const user = seedUser({ username: "orderer" });
            seedConversation({ userId: user.id, title: "oldest", updatedAt: "2024-01-01T00:00:00.000Z" });
            seedConversation({ userId: user.id, title: "newest", updatedAt: "2024-06-01T00:00:00.000Z" });
            seedConversation({ userId: user.id, title: "middle", updatedAt: "2024-03-01T00:00:00.000Z" });

            const result = listConversations(user.id, { page: 1, page_size: 20, sort: "-updated_at" });
            expect(result.items.map((c) => c.title)).toEqual(["newest", "middle", "oldest"]);
        });

        it("paginates results and reports the un-paginated total", () => {
            const user = seedUser({ username: "paginator" });
            for (let i = 0; i < 5; i++) {
                seedConversation({ userId: user.id, title: `conv-${i}`, updatedAt: new Date(2024, 0, i + 1).toISOString() });
            }
            const page1 = listConversations(user.id, { page: 1, page_size: 2, sort: "-updated_at" });
            expect(page1.total).toBe(5);
            expect(page1.items.map((c) => c.title)).toEqual(["conv-4", "conv-3"]);

            const page2 = listConversations(user.id, { page: 2, page_size: 2, sort: "-updated_at" });
            expect(page2.items.map((c) => c.title)).toEqual(["conv-2", "conv-1"]);
        });

        it("maps the DTO shape including optional group_id", () => {
            const user = seedUser({ username: "shaper" });
            const conv = seedConversation({ userId: user.id, title: "shaped", groupId: "group-1", config: { model: "gpt-4o" } });
            const result = listConversations(user.id, { page: 1, page_size: 20, sort: "-updated_at" });
            expect(result.items[0]).toEqual({
                id: conv.id,
                user_id: user.id,
                title: "shaped",
                config: { model: "gpt-4o" },
                group_id: "group-1",
                created_at: conv.createdAt,
                updated_at: conv.updatedAt,
                is_deleted: false,
            });
        });

        it("leaves group_id undefined (not null) when unset", () => {
            const user = seedUser({ username: "no-group" });
            seedConversation({ userId: user.id, title: "solo" });
            const result = listConversations(user.id, { page: 1, page_size: 20, sort: "-updated_at" });
            expect(result.items[0].group_id).toBeUndefined();
        });
    });

    describe("softDeleteConversation", () => {
        it("marks a conversation deleted and bumps updated_at", () => {
            const user = seedUser({ username: "owner" });
            const conv = seedConversation({ userId: user.id, updatedAt: "2020-01-01T00:00:00.000Z" });
            softDeleteConversation(user.id, conv.id);

            const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
            expect(row.isDeleted).toBe(true);
            expect(row.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
        });

        it("throws 404 for a conversation that doesn't exist", () => {
            const user = seedUser({ username: "owner2" });
            expect(() => softDeleteConversation(user.id, "nonexistent")).toThrow(HttpError);
            try {
                softDeleteConversation(user.id, "nonexistent");
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("throws 403 when the conversation belongs to another user", () => {
            const owner = seedUser({ username: "real-owner" });
            const attacker = seedUser({ username: "attacker" });
            const conv = seedConversation({ userId: owner.id });

            expect(() => softDeleteConversation(attacker.id, conv.id)).toThrow(HttpError);
            try {
                softDeleteConversation(attacker.id, conv.id);
            } catch (err) {
                expect((err as HttpError).status).toBe(403);
            }
            const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
            expect(row.isDeleted).toBe(false);
        });
    });

    describe("updateConversationTitle", () => {
        it("updates the title", () => {
            const user = seedUser({ username: "titler" });
            const conv = seedConversation({ userId: user.id, title: "old title" });
            updateConversationTitle(user.id, conv.id, { title: "new title" });
            const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
            expect(row.title).toBe("new title");
        });

        it("writes when expected_title matches the current title (CAS success)", () => {
            const user = seedUser({ username: "cas-success" });
            const conv = seedConversation({ userId: user.id, title: "draft title" });
            updateConversationTitle(user.id, conv.id, { title: "final title", expected_title: "draft title" });
            const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
            expect(row.title).toBe("final title");
        });

        it("silently no-ops when expected_title does not match (CAS mismatch, no error thrown)", () => {
            const user = seedUser({ username: "cas-mismatch" });
            const conv = seedConversation({ userId: user.id, title: "user already renamed me" });
            expect(() =>
                updateConversationTitle(user.id, conv.id, { title: "background LLM title", expected_title: "stale snapshot" }),
            ).not.toThrow();
            const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
            expect(row.title).toBe("user already renamed me");
        });

        it("throws 404 for a conversation that doesn't exist", () => {
            const user = seedUser({ username: "titler2" });
            expect(() => updateConversationTitle(user.id, "nonexistent", { title: "x" })).toThrow(HttpError);
            try {
                updateConversationTitle(user.id, "nonexistent", { title: "x" });
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("throws 403 when the conversation belongs to another user", () => {
            const owner = seedUser({ username: "real-owner2" });
            const attacker = seedUser({ username: "attacker2" });
            const conv = seedConversation({ userId: owner.id, title: "protected" });

            expect(() => updateConversationTitle(attacker.id, conv.id, { title: "hijacked" })).toThrow(HttpError);
            try {
                updateConversationTitle(attacker.id, conv.id, { title: "hijacked" });
            } catch (err) {
                expect((err as HttpError).status).toBe(403);
            }
            const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id)).get()!;
            expect(row.title).toBe("protected");
        });
    });
});
