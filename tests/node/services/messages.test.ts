import { beforeEach, describe, expect, it } from "vitest";
import { listMessages } from "@/lib/server/conversations";
import { HttpError } from "@/lib/server/response";
import { rateMessage } from "@/lib/server/messages";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedConversation, seedMessage, seedUser } from "../../helpers/db";

function ts(offsetSeconds: number): string {
    return new Date(2024, 0, 1, 0, 0, offsetSeconds).toISOString();
}

describe("messages service (listMessages + rateMessage)", () => {
    beforeEach(() => resetDb());

    describe("listMessages", () => {
        it("throws 404 when the conversation doesn't exist", () => {
            const user = seedUser({ username: "u1" });
            expect(() => listMessages(user.id, "nonexistent", { page: 1, page_size: 50, sort: "-created_at" })).toThrow(HttpError);
            try {
                listMessages(user.id, "nonexistent", { page: 1, page_size: 50, sort: "-created_at" });
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("throws 403 when the conversation belongs to another user", () => {
            const owner = seedUser({ username: "owner" });
            const attacker = seedUser({ username: "attacker" });
            const conv = seedConversation({ userId: owner.id });
            seedMessage({ conversationId: conv.id, role: "user", content: "hi" });

            expect(() => listMessages(attacker.id, conv.id, { page: 1, page_size: 50, sort: "-created_at" })).toThrow(HttpError);
            try {
                listMessages(attacker.id, conv.id, { page: 1, page_size: 50, sort: "-created_at" });
            } catch (err) {
                expect((err as HttpError).status).toBe(403);
            }
        });

        it("returns an empty page for a conversation with no messages", () => {
            const user = seedUser({ username: "empty-conv-user" });
            const conv = seedConversation({ userId: user.id });
            const result = listMessages(user.id, conv.id, { page: 1, page_size: 50, sort: "-created_at" });
            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });

        it("paginates a flat list of top-level messages and reports the correct total", () => {
            const user = seedUser({ username: "flat-user" });
            const conv = seedConversation({ userId: user.id });
            for (let i = 0; i < 5; i++) {
                seedMessage({ conversationId: conv.id, role: i % 2 === 0 ? "user" : "assistant", content: `msg-${i}`, createdAt: ts(i) });
            }
            const page1 = listMessages(user.id, conv.id, { page: 1, page_size: 2, sort: "created_at" });
            expect(page1.total).toBe(5);
            expect(page1.items.map((m) => m.content)).toEqual(["msg-0", "msg-1"]);

            const page2 = listMessages(user.id, conv.id, { page: 2, page_size: 2, sort: "created_at" });
            expect(page2.items.map((m) => m.content)).toEqual(["msg-2", "msg-3"]);
        });

        it("supports descending order (newest first)", () => {
            const user = seedUser({ username: "desc-user" });
            const conv = seedConversation({ userId: user.id });
            for (let i = 0; i < 3; i++) {
                seedMessage({ conversationId: conv.id, role: "user", content: `msg-${i}`, createdAt: ts(i) });
            }
            const result = listMessages(user.id, conv.id, { page: 1, page_size: 10, sort: "-created_at" });
            expect(result.items.map((m) => m.content)).toEqual(["msg-2", "msg-1", "msg-0"]);
        });

        it("excludes inactive (isActive=false) messages", () => {
            const user = seedUser({ username: "inactive-user" });
            const conv = seedConversation({ userId: user.id });
            seedMessage({ conversationId: conv.id, role: "user", content: "visible", createdAt: ts(0) });
            seedMessage({ conversationId: conv.id, role: "user", content: "hidden", createdAt: ts(1), isActive: false });
            const result = listMessages(user.id, conv.id, { page: 1, page_size: 10, sort: "created_at" });
            expect(result.items.map((m) => m.content)).toEqual(["visible"]);
            expect(result.total).toBe(1);
        });

        it("maps the full DTO shape for a message", () => {
            const user = seedUser({ username: "shape-user" });
            const conv = seedConversation({ userId: user.id });
            const msg = seedMessage({
                conversationId: conv.id,
                role: "assistant",
                content: "hello there",
                reasoningContent: "thinking...",
                modelId: "gpt-4o-mini",
                generationId: "gen-1",
                rating: "up",
                feedback: "great answer",
                createdAt: ts(0),
            });
            const result = listMessages(user.id, conv.id, { page: 1, page_size: 10, sort: "created_at" });
            expect(result.items[0]).toEqual({
                id: msg.id,
                conversation_id: conv.id,
                role: "assistant",
                content: "hello there",
                reasoning_content: "thinking...",
                model_id: "gpt-4o-mini",
                generation_id: "gen-1",
                parent_id: undefined,
                is_active: true,
                rating: "up",
                feedback: "great answer",
                error: undefined,
                created_at: ts(0),
            });
        });

        it("completes a page with ancestor AND descendant pulling for subtree completeness", () => {
            // A single tool-calling turn: user -> assistant(tool_calls) -> tool -> tool -> assistant(final).
            const user = seedUser({ username: "tree-user" });
            const conv = seedConversation({ userId: user.id });
            const m1 = seedMessage({ conversationId: conv.id, role: "user", content: "what's the weather?", createdAt: ts(0) });
            const m2 = seedMessage({ conversationId: conv.id, role: "assistant", content: "", parentId: m1.id, createdAt: ts(1) });
            const m3 = seedMessage({ conversationId: conv.id, role: "tool", content: "sunny", parentId: m2.id, createdAt: ts(2) });
            const m4 = seedMessage({ conversationId: conv.id, role: "tool", content: "72F", parentId: m2.id, createdAt: ts(3) });
            const m5 = seedMessage({ conversationId: conv.id, role: "assistant", content: "It's sunny and 72F.", parentId: m4.id, createdAt: ts(4) });

            // Page 1 (page_size=2, newest-first) only directly covers [m5, m4].
            const result = listMessages(user.id, conv.id, { page: 1, page_size: 2, sort: "-created_at" });

            // total reflects the UN-expanded base count (5), not the expanded item count.
            expect(result.total).toBe(5);
            // But the actual items returned exceed page_size because the subtree
            // was completed: m4's parent (m2) and grandparent (m1) are pulled in as
            // ancestors, and m2's other tool child (m3) is pulled in as a descendant.
            const ids = result.items.map((m) => m.id).sort();
            expect(ids).toEqual([m1.id, m2.id, m3.id, m4.id, m5.id].sort());
        });

        it("does NOT pull tool children of an errored assistant (defense-in-depth orphan guard)", () => {
            const user = seedUser({ username: "error-guard-user" });
            const conv = seedConversation({ userId: user.id });
            const m1 = seedMessage({ conversationId: conv.id, role: "user", content: "call a tool", createdAt: ts(0) });
            const m2 = seedMessage({ conversationId: conv.id, role: "assistant", content: "", parentId: m1.id, createdAt: ts(1), error: "upstream failure" });
            // m3 is an orphaned tool row under the errored assistant — pre-existing
            // defense-in-depth scenario (assistant never finished the tool_calls
            // protocol), so this leftover row must not resurface via completion.
            seedMessage({ conversationId: conv.id, role: "tool", content: "never delivered", parentId: m2.id, createdAt: ts(2) });
            // Two unrelated newer top-level messages so a page_size=1 window can
            // isolate m2 by itself (idx3, newest-first) on its own page, one page
            // away from m3 (idx2) — proving m3 is excluded via the guard and not
            // merely because it fell outside the raw page window for other reasons.
            seedMessage({ conversationId: conv.id, role: "user", content: "unrelated-1", createdAt: ts(3) });
            seedMessage({ conversationId: conv.id, role: "user", content: "unrelated-2", createdAt: ts(4) });

            const page4 = listMessages(user.id, conv.id, { page: 4, page_size: 1, sort: "-created_at" });
            expect(page4.total).toBe(5);
            // m2 is pulled directly (its own page); m1 is pulled in as its ancestor;
            // m3 (tool child of the errored m2) must NOT be pulled in.
            expect(page4.items.map((m) => m.id).sort()).toEqual([m1.id, m2.id].sort());
        });
    });

    describe("rateMessage", () => {
        it("sets a thumbs-up rating with feedback", () => {
            const user = seedUser({ username: "rater" });
            const conv = seedConversation({ userId: user.id });
            const msg = seedMessage({ conversationId: conv.id, role: "assistant", content: "answer" });

            rateMessage(user.id, msg.id, { rating: "up", feedback: "nice" });
            const row = db.select().from(schema.messages).where(eq(schema.messages.id, msg.id)).get()!;
            expect(row.rating).toBe("up");
            expect(row.feedback).toBe("nice");
        });

        it("sets a thumbs-down rating", () => {
            const user = seedUser({ username: "rater2" });
            const conv = seedConversation({ userId: user.id });
            const msg = seedMessage({ conversationId: conv.id, role: "assistant", content: "answer" });

            rateMessage(user.id, msg.id, { rating: "down" });
            const row = db.select().from(schema.messages).where(eq(schema.messages.id, msg.id)).get()!;
            expect(row.rating).toBe("down");
            expect(row.feedback).toBeNull();
        });

        it("clears a rating when 'none' is sent", () => {
            const user = seedUser({ username: "rater3" });
            const conv = seedConversation({ userId: user.id });
            const msg = seedMessage({ conversationId: conv.id, role: "assistant", content: "answer", rating: "up", feedback: "old" });

            rateMessage(user.id, msg.id, { rating: "none" });
            const row = db.select().from(schema.messages).where(eq(schema.messages.id, msg.id)).get()!;
            expect(row.rating).toBeNull();
            expect(row.feedback).toBeNull();
        });

        it("throws 404 when the message doesn't exist", () => {
            const user = seedUser({ username: "rater4" });
            expect(() => rateMessage(user.id, "nonexistent", { rating: "up" })).toThrow(HttpError);
            try {
                rateMessage(user.id, "nonexistent", { rating: "up" });
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("throws 403 when the message's conversation belongs to another user", () => {
            const owner = seedUser({ username: "owner3" });
            const attacker = seedUser({ username: "attacker3" });
            const conv = seedConversation({ userId: owner.id });
            const msg = seedMessage({ conversationId: conv.id, role: "assistant", content: "answer" });

            expect(() => rateMessage(attacker.id, msg.id, { rating: "up" })).toThrow(HttpError);
            try {
                rateMessage(attacker.id, msg.id, { rating: "up" });
            } catch (err) {
                expect((err as HttpError).status).toBe(403);
            }
            const row = db.select().from(schema.messages).where(eq(schema.messages.id, msg.id)).get()!;
            expect(row.rating).toBeNull();
        });
    });
});
