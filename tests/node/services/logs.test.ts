import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import type { User } from "@/lib/server/db/schema";
import type { SessionUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/response";
import { assertLogReadable, getLog, listLogs } from "@/lib/server/logs";
import { persistImageArtifacts, readArtifact } from "@/lib/server/gateway/artifacts";
import { resetDb, seedAdmin, seedLog, seedUser } from "../../helpers/db";

vi.mock("@/lib/server/gateway/artifacts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/gateway/artifacts")>();
    return { ...actual, persistImageArtifacts: vi.fn(actual.persistImageArtifacts) };
});

function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

// A valid, minimal 1x1 transparent PNG.
const TINY_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("logs service", () => {
    beforeEach(() => resetDb());

    describe("listLogs", () => {
        it("scopes a non-admin user to their own logs, ignoring any user_id filter they pass", () => {
            const alice = seedUser({ username: "alice" });
            const bob = seedUser({ username: "bob" });
            seedLog({ userId: alice.id, modelName: "alice-model" });
            seedLog({ userId: bob.id, modelName: "bob-model" });

            const result = listLogs(toSessionUser(alice), { page: 1, page_size: 20, sort: "-created_at", user_id: bob.id });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].model_name).toBe("alice-model");
        });

        it("lets an admin see every user's logs by default", () => {
            const admin = seedAdmin({ username: "root" });
            const alice = seedUser({ username: "alice2" });
            const bob = seedUser({ username: "bob2" });
            seedLog({ userId: alice.id, modelName: "alice-model" });
            seedLog({ userId: bob.id, modelName: "bob-model" });

            const result = listLogs(toSessionUser(admin), { page: 1, page_size: 20, sort: "-created_at" });
            expect(result.items).toHaveLength(2);
        });

        it("lets an admin scope to one user via user_id", () => {
            const admin = seedAdmin({ username: "root2" });
            const alice = seedUser({ username: "alice3" });
            const bob = seedUser({ username: "bob3" });
            seedLog({ userId: alice.id, modelName: "alice-model" });
            seedLog({ userId: bob.id, modelName: "bob-model" });

            const result = listLogs(toSessionUser(admin), { page: 1, page_size: 20, sort: "-created_at", user_id: alice.id });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].model_name).toBe("alice-model");
        });

        it("filters by model_name (substring match)", () => {
            const user = seedUser({ username: "model-filter-user" });
            seedLog({ userId: user.id, modelName: "gpt-4o-mini" });
            seedLog({ userId: user.id, modelName: "claude-3.5" });
            const result = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at", model_name: "gpt" });
            expect(result.items.map((l) => l.model_name)).toEqual(["gpt-4o-mini"]);
        });

        it("filters by capability", () => {
            const user = seedUser({ username: "cap-filter-user" });
            seedLog({ userId: user.id, capability: "chat" });
            seedLog({ userId: user.id, capability: "embedding" });
            const result = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at", capability: "embedding" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].capability).toBe("embedding");
        });

        it("filters by status", () => {
            const user = seedUser({ username: "status-filter-user" });
            seedLog({ userId: user.id, status: "completed" });
            seedLog({ userId: user.id, status: "failed" });
            const result = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at", status: "failed" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].status).toBe("failed");
        });

        it("excludes soft-deleted logs from the list", () => {
            const user = seedUser({ username: "soft-delete-user" });
            seedLog({ userId: user.id, modelName: "alive" });
            seedLog({ userId: user.id, modelName: "dead", isDeleted: true });
            const result = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at" });
            expect(result.items.map((l) => l.model_name)).toEqual(["alive"]);
        });

        it("paginates and reports the correct total", () => {
            const user = seedUser({ username: "paginator" });
            for (let i = 0; i < 5; i++) {
                seedLog({ userId: user.id, modelName: `m-${i}`, createdAt: new Date(2024, 0, i + 1).toISOString() });
            }
            const page1 = listLogs(toSessionUser(user), { page: 1, page_size: 2, sort: "created_at" });
            expect(page1.total).toBe(5);
            expect(page1.items.map((l) => l.model_name)).toEqual(["m-0", "m-1"]);
        });

        it("returns an empty list when there are no matches", () => {
            const user = seedUser({ username: "no-logs-user" });
            const result = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at" });
            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });

        it("sorts by model_name, status, first_token_latency_ms, and total_latency_ms", () => {
            const user = seedUser({ username: "sort-user" });
            seedLog({ userId: user.id, modelName: "zeta", status: "completed", firstTokenLatencyMs: 300, totalLatencyMs: 900 });
            seedLog({ userId: user.id, modelName: "alpha", status: "failed", firstTokenLatencyMs: 100, totalLatencyMs: 500 });

            expect(listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "model_name" }).items.map((l) => l.model_name)).toEqual(["alpha", "zeta"]);
            expect(listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-model_name" }).items.map((l) => l.model_name)).toEqual(["zeta", "alpha"]);
            expect(listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "status" }).items.map((l) => l.status)).toEqual(["completed", "failed"]);
            expect(listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "first_token_latency_ms" }).items.map((l) => l.first_token_latency_ms)).toEqual([100, 300]);
            expect(listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-total_latency_ms" }).items.map((l) => l.total_latency_ms)).toEqual([900, 500]);
        });

        it("defaults to sorting by -created_at", () => {
            const user = seedUser({ username: "default-sort-user" });
            seedLog({ userId: user.id, modelName: "older", createdAt: "2024-01-01T00:00:00.000Z" });
            seedLog({ userId: user.id, modelName: "newer", createdAt: "2024-06-01T00:00:00.000Z" });
            const result = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at" });
            expect(result.items.map((l) => l.model_name)).toEqual(["newer", "older"]);
        });

        it("resolves the username via the left join", () => {
            const user = seedUser({ username: "joined-user" });
            const log = seedLog({ userId: user.id });
            const before = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at" });
            expect(before.items[0].username).toBe("joined-user");
            expect(log.userId).toBe(user.id);
        });
    });

    describe("null-field handling (bare row with every optional column NULL)", () => {
        it("nulls/defaults every optional field consistently in both listLogs and getLog", async () => {
            const user = seedUser({ username: "minimal-user" });
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            db.insert(schema.generationLogs).values({
                id,
                userId: user.id,
                modelName: "bare-model",
                capability: null,
                status: "pending",
                input: null,
                inputSummary: null,
                output: null,
                reason: null,
                generationKwargs: {},
                generation: null,
                conversationId: null,
                messageId: null,
                promptTokens: null,
                completionTokens: null,
                totalTokens: null,
                firstTokenLatencyMs: null,
                totalLatencyMs: null,
                isDeleted: false,
                createdAt: now,
                updatedAt: now,
            }).run();

            const list = listLogs(toSessionUser(user), { page: 1, page_size: 20, sort: "-created_at" });
            const item = list.items.find((l) => l.id === id)!;
            expect(item.capability).toBeNull();
            expect(item.input_summary).toBeNull();
            expect(item.input).toBe("");
            expect(item.output).toBe("");
            expect(item.prompt_tokens).toBeNull();
            expect(item.completion_tokens).toBeNull();
            expect(item.total_tokens).toBeNull();
            expect(item.first_token_latency_ms).toBeNull();
            expect(item.total_latency_ms).toBeNull();

            const detail = await getLog(toSessionUser(user), id);
            expect(detail.capability).toBeNull();
            expect(detail.input_summary).toBeNull();
            expect(detail.input).toBeNull();
            expect(detail.output).toBe("");
            expect(detail.conversation_id).toBeUndefined();
            expect(detail.message_id).toBeUndefined();
            expect(detail.prompt_tokens).toBeNull();
            expect(detail.completion_tokens).toBeNull();
            expect(detail.total_tokens).toBeNull();
            expect(detail.first_token_latency_ms).toBeNull();
            expect(detail.total_latency_ms).toBeNull();
            expect(detail.generation).toBeNull();
        });
    });

    describe("getLog", () => {
        it("returns the full detail DTO, including a set conversation_id/message_id", async () => {
            const user = seedUser({ username: "detail-user" });
            const log = seedLog({
                userId: user.id,
                modelName: "gpt-4o",
                input: { messages: [{ role: "user", content: "hi" }] },
                conversationId: "conv-123",
                messageId: "msg-456",
            });
            const dto = await getLog(toSessionUser(user), log.id);
            expect(dto.id).toBe(log.id);
            expect(dto.model_name).toBe("gpt-4o");
            expect(dto.input).toEqual({ messages: [{ role: "user", content: "hi" }] });
            expect(dto.username).toBe("detail-user");
            expect(dto.conversation_id).toBe("conv-123");
            expect(dto.message_id).toBe("msg-456");
        });

        it("throws 404 for an unknown id", async () => {
            const user = seedUser({ username: "detail-user2" });
            await expect(getLog(toSessionUser(user), "nonexistent")).rejects.toThrow(HttpError);
            await expect(getLog(toSessionUser(user), "nonexistent")).rejects.toMatchObject({ status: 404 });
        });

        it("forbids a non-admin from reading another user's log", async () => {
            const owner = seedUser({ username: "log-owner" });
            const attacker = seedUser({ username: "log-attacker" });
            const log = seedLog({ userId: owner.id });

            await expect(getLog(toSessionUser(attacker), log.id)).rejects.toThrow(HttpError);
            await expect(getLog(toSessionUser(attacker), log.id)).rejects.toMatchObject({ status: 403 });
        });

        it("lets an admin read any user's log", async () => {
            const admin = seedAdmin({ username: "root3" });
            const owner = seedUser({ username: "log-owner2" });
            const log = seedLog({ userId: owner.id, modelName: "owned-by-owner" });

            const dto = await getLog(toSessionUser(admin), log.id);
            expect(dto.model_name).toBe("owned-by-owner");
        });

        it("remains individually fetchable even after being soft-deleted (no is_deleted gate on getLog)", async () => {
            const user = seedUser({ username: "soft-deleted-getter" });
            const log = seedLog({ userId: user.id, isDeleted: true });
            const dto = await getLog(toSessionUser(user), log.id);
            expect(dto.id).toBe(log.id);
            expect(dto.is_deleted).toBe(true);
        });

        it("lazily migrates inline b64_json image data to a persisted artifact on first read", async () => {
            const user = seedUser({ username: "image-user" });
            const log = seedLog({
                userId: user.id,
                capability: "image",
                generation: { data: [{ b64_json: TINY_PNG_B64, output_format: "png" }] },
            });

            const dto = await getLog(toSessionUser(user), log.id);
            const entry = (dto.generation as { data: Array<Record<string, unknown>> }).data[0];
            expect(entry.b64_json).toBeUndefined();
            expect(entry.loom_artifact).toBe(true);
            expect(typeof entry.url).toBe("string");
            expect(entry.mime).toBe("image/png");
            expect(entry.bytes).toBeGreaterThan(0);

            // Persisted back to the DB row too, so subsequent reads don't re-migrate.
            const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, log.id)).get()!;
            const persistedEntry = (row.generation as { data: Array<Record<string, unknown>> }).data[0];
            expect(persistedEntry.b64_json).toBeUndefined();
            expect(persistedEntry.loom_artifact).toBe(true);

            // And the artifact is actually readable from disk via the real reader.
            const artifact = await readArtifact(log.id, 0);
            expect(artifact).not.toBeNull();
            expect(artifact!.mime).toBe("image/png");
        });

        it("does not attempt migration for image logs without inline b64 data", async () => {
            const user = seedUser({ username: "image-user-clean" });
            const log = seedLog({
                userId: user.id,
                capability: "image",
                generation: { data: [{ url: "https://upstream.example.com/already-hosted.png" }] },
            });
            const dto = await getLog(toSessionUser(user), log.id);
            const entry = (dto.generation as { data: Array<Record<string, unknown>> }).data[0];
            expect(entry.url).toBe("https://upstream.example.com/already-hosted.png");
            expect(entry.loom_artifact).toBeUndefined();
        });

        it("does not attempt migration for non-image capabilities even with a data[] shape", async () => {
            const user = seedUser({ username: "non-image-user" });
            const log = seedLog({
                userId: user.id,
                capability: "chat",
                generation: { data: [{ b64_json: TINY_PNG_B64 }] },
            });
            const dto = await getLog(toSessionUser(user), log.id);
            const entry = (dto.generation as { data: Array<Record<string, unknown>> }).data[0];
            // Untouched — migration is gated on capability === "image".
            expect(entry.b64_json).toBe(TINY_PNG_B64);
        });

        it("fails open: still returns the log if artifact persistence throws mid-migration", async () => {
            const user = seedUser({ username: "image-user-failing" });
            const log = seedLog({
                userId: user.id,
                capability: "image",
                generation: { data: [{ b64_json: TINY_PNG_B64, output_format: "png" }] },
            });
            vi.mocked(persistImageArtifacts).mockRejectedValueOnce(new Error("disk full"));

            const dto = await getLog(toSessionUser(user), log.id);
            const entry = (dto.generation as { data: Array<Record<string, unknown>> }).data[0];
            // Migration failed, so the original (unmigrated) data survives —
            // the read itself must not fail just because persistence did.
            expect(entry.b64_json).toBe(TINY_PNG_B64);
            expect(entry.loom_artifact).toBeUndefined();

            const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, log.id)).get()!;
            const persistedEntry = (row.generation as { data: Array<Record<string, unknown>> }).data[0];
            expect(persistedEntry.b64_json).toBe(TINY_PNG_B64);
        });
    });

    describe("assertLogReadable", () => {
        it("does not throw for the log's owner", () => {
            const user = seedUser({ username: "readable-owner" });
            const log = seedLog({ userId: user.id });
            expect(() => assertLogReadable(toSessionUser(user), log.id)).not.toThrow();
        });

        it("does not throw for an admin reading any log", () => {
            const admin = seedAdmin({ username: "readable-admin" });
            const owner = seedUser({ username: "readable-owner2" });
            const log = seedLog({ userId: owner.id });
            expect(() => assertLogReadable(toSessionUser(admin), log.id)).not.toThrow();
        });

        it("throws 404 for an unknown id", () => {
            const user = seedUser({ username: "readable-user" });
            expect(() => assertLogReadable(toSessionUser(user), "nonexistent")).toThrow(HttpError);
            try {
                assertLogReadable(toSessionUser(user), "nonexistent");
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("throws 403 for a non-owner, non-admin caller", () => {
            const owner = seedUser({ username: "readable-owner3" });
            const attacker = seedUser({ username: "readable-attacker" });
            const log = seedLog({ userId: owner.id });
            expect(() => assertLogReadable(toSessionUser(attacker), log.id)).toThrow(HttpError);
            try {
                assertLogReadable(toSessionUser(attacker), log.id);
            } catch (err) {
                expect((err as HttpError).status).toBe(403);
            }
        });
    });
});
