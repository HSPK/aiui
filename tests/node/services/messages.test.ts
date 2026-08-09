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

        // The three assertions below cover a bug that shipped despite the
        // subtree-completion test above passing: that test only compared a
        // *set of ids*, and the ancestor rows came back from raw SQL whose
        // generic (`db.all<typeof messages.$inferSelect>`) asserted a shape
        // Drizzle never actually produced. The ids were right; everything
        // else about those rows was wrong.
        describe("ancestor rows are fully hydrated, not raw SQLite rows", () => {
            /** user -> assistant -> user -> assistant, so a small page window
             *  forces the ancestor walk to climb past the page boundary. */
            function seedChain(username: string) {
                const user = seedUser({ username });
                const conv = seedConversation({ userId: user.id });
                const m1 = seedMessage({
                    conversationId: conv.id, role: "user", createdAt: ts(0),
                    content: [{ type: "text", text: "first question" }],
                });
                const m2 = seedMessage({
                    conversationId: conv.id, role: "assistant", parentId: m1.id, createdAt: ts(1),
                    content: [{ type: "text", text: "first answer" }],
                });
                const m3 = seedMessage({
                    conversationId: conv.id, role: "user", parentId: m2.id, createdAt: ts(2),
                    content: [{ type: "text", text: "second question" }],
                });
                const m4 = seedMessage({
                    conversationId: conv.id, role: "assistant", parentId: m3.id, createdAt: ts(3),
                    content: [{ type: "text", text: "second answer" }],
                });
                return { user, conv, m1, m2, m3, m4 };
            }

            it("decodes array content instead of leaking the stored JSON string", () => {
                // Raw SQL skips Drizzle's `mode: "json"` decoding, so ancestors
                // arrived as the literal string `[{"type":"text",...}]` and the
                // FE rendered it verbatim in the chat bubble.
                const { user, conv } = seedChain("hydrate-content");

                const page = listMessages(user.id, conv.id, { page: 1, page_size: 1, sort: "-created_at" });

                expect(page.items.length).toBeGreaterThan(1);
                for (const m of page.items) {
                    expect(Array.isArray(m.content), `content of ${m.role} should be an array`).toBe(true);
                }
                expect(page.items.map((m) => m.content)).toContainEqual([{ type: "text", text: "first question" }]);
            });

            it("maps created_at instead of dropping it on the snake_case boundary", () => {
                // `SELECT m.*` yields `created_at`, so `row.createdAt` was
                // undefined and the DTO carried no timestamp at all.
                const { user, conv } = seedChain("hydrate-timestamps");

                const page = listMessages(user.id, conv.id, { page: 1, page_size: 1, sort: "-created_at" });

                for (const m of page.items) {
                    expect(m.created_at, `created_at of ${m.role}`).toBeTruthy();
                }
            });

            it("keeps the whole page in the requested order once ancestors join it", () => {
                // Undefined timestamps made every ancestor compare equal in the
                // merge sort, so the list silently degraded to id order — which
                // is what surfaced as a scrambled conversation.
                const { user, conv } = seedChain("hydrate-order");

                const desc = listMessages(user.id, conv.id, { page: 1, page_size: 1, sort: "-created_at" });
                const descTimes = desc.items.map((m) => m.created_at);
                expect(descTimes).toEqual([...descTimes].sort().reverse());

                const asc = listMessages(user.id, conv.id, { page: 1, page_size: 1, sort: "created_at" });
                const ascTimes = asc.items.map((m) => m.created_at);
                expect(ascTimes).toEqual([...ascTimes].sort());
            });

            it("returns each message once when the ancestor walk re-reaches the page window", () => {
                // The walk climbs to the root, so it re-reports rows the page
                // already held; the merge concatenated without checking.
                const { user, conv } = seedChain("dedup-ancestors");

                const page = listMessages(user.id, conv.id, { page: 1, page_size: 3, sort: "-created_at" });

                const ids = page.items.map((m) => m.id);
                expect(ids).toHaveLength(new Set(ids).size);
            });

            it("hydrates the remaining scalar columns the DTO exposes", () => {
                const user = seedUser({ username: "hydrate-scalars" });
                const conv = seedConversation({ userId: user.id });
                const parent = seedMessage({
                    conversationId: conv.id, role: "user", content: "q", createdAt: ts(0),
                });
                seedMessage({
                    conversationId: conv.id, role: "assistant", parentId: parent.id, createdAt: ts(1),
                    content: "a", modelId: "gpt-4o", generationId: "gen-1",
                    reasoningContent: "thinking", rating: "up", feedback: "great",
                });

                const page = listMessages(user.id, conv.id, { page: 1, page_size: 1, sort: "-created_at" });
                const ancestor = page.items.find((m) => m.id === parent.id)!;

                expect(ancestor.conversation_id).toBe(conv.id);
                expect(ancestor.role).toBe("user");
                expect(ancestor.is_active).toBe(true);
                expect(ancestor.parent_id).toBeUndefined();

                const assistant = page.items.find((m) => m.id !== parent.id)!;
                expect(assistant.parent_id).toBe(parent.id);
                expect(assistant.model_id).toBe("gpt-4o");
                expect(assistant.generation_id).toBe("gen-1");
                expect(assistant.reasoning_content).toBe("thinking");
                expect(assistant.rating).toBe("up");
                expect(assistant.feedback).toBe("great");
            });
        });

        it("bounds the ancestor walk so a page is a page, not the whole history", () => {
            // The walk used to climb to the root. In a linear chat every
            // message's parent is its predecessor, so seeding from the
            // oldest row of any page dragged the entire conversation back
            // — opening a chat loaded it from the beginning instead of the
            // end. Measured here at 60/60 before the depth cap.
            const user = seedUser({ username: "long-linear-chat" });
            const conv = seedConversation({ userId: user.id });
            let parent: string | null = null;
            for (let i = 0; i < 60; i++) {
                const m = seedMessage({
                    conversationId: conv.id,
                    role: i % 2 === 0 ? "user" : "assistant",
                    content: `msg-${i}`,
                    parentId: parent,
                    createdAt: ts(i),
                });
                parent = m.id;
            }

            const page = listMessages(user.id, conv.id, { page: 1, page_size: 20, sort: "-created_at" });

            expect(page.total).toBe(60);
            // A handful of ancestor rows may ride along to complete the
            // page's oldest turn, but the response must stay proportional
            // to page_size rather than to the conversation.
            expect(page.items.length).toBeGreaterThanOrEqual(20);
            expect(page.items.length).toBeLessThanOrEqual(25);
            // And it must be the *newest* slice — this is the end of the
            // conversation, not the start of it.
            const contents = page.items.map((m) => m.content);
            expect(contents).toContain("msg-59");
            expect(contents).not.toContain("msg-0");
        });

        it("still completes the oldest turn on a page so tool rows keep their assistant", () => {
            // The cap must not cost us the reason the walk exists: when a
            // page window opens on a tool row, its assistant parent (and
            // that assistant's user turn) still come along.
            const user = seedUser({ username: "capped-but-complete" });
            const conv = seedConversation({ userId: user.id });
            const u = seedMessage({ conversationId: conv.id, role: "user", content: "call a tool", createdAt: ts(0) });
            const a = seedMessage({ conversationId: conv.id, role: "assistant", content: "", parentId: u.id, createdAt: ts(1) });
            const t = seedMessage({ conversationId: conv.id, role: "tool", content: "result", parentId: a.id, createdAt: ts(2) });

            // page_size=1 newest-first puts the tool row alone in the window.
            const page = listMessages(user.id, conv.id, { page: 1, page_size: 1, sort: "-created_at" });

            expect(page.items.map((m) => m.id).sort()).toEqual([u.id, a.id, t.id].sort());
        });

        it("does NOT pull tool children of an errored assistant (defense-in-depth orphan guard)", () => {            const user = seedUser({ username: "error-guard-user" });
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
