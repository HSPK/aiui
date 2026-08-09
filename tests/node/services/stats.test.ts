import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import type { User } from "@/lib/server/db/schema";
import type { SessionUser } from "@/lib/server/auth";
import { listAllModels } from "@/lib/server/models";
import { getModelStats, getOverview } from "@/lib/server/stats";
import { resetDb, seedAdmin, seedLog, seedModel, seedProvider, seedUser } from "../../helpers/db";

// getModelStats's only cross-domain call is listAllModels (catalog lookup for
// provider/capability/description/context_window/max_tokens meta). Wrapped
// so specific tests can force catalog edge cases (fields missing from a
// resolved entry, discovery failure) without needing real provider/model
// seeding for every case. `vi.fn(actual.listAllModels)` keeps calling through
// to the real implementation by default, so every other existing test keeps
// exercising genuine DB-backed resolution unless it opts into an override
// via `mockResolvedValueOnce`/`mockRejectedValueOnce` (which self-consumes
// after a single call, so no explicit restore is needed for it).
vi.mock("@/lib/server/models", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/models")>();
    return { ...actual, listAllModels: vi.fn(actual.listAllModels) };
});

function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function today(): string {
    return new Date().toISOString();
}

/** Stubs `db.select(...)` to return a fixed sequence of already-resolved
 *  rows/values (in call order), completely bypassing SQL. This exists only
 *  to exercise the JS-level `?? 0` / `?? null` defensive coalescing that
 *  guards against a malformed or absent aggregate row/field — a shape
 *  SQLite's own aggregate semantics never actually produce through real
 *  seeding (COUNT and COALESCE(SUM(...), 0) never return null, and an
 *  ungrouped aggregate / a populated GROUP BY never yields a missing row).
 *  Callers MUST `.mockRestore()` the returned spy (e.g. in a try/finally)
 *  so later tests keep hitting the real `db`. */
function mockSelectSequence(...specs: Array<{ get?: unknown; all?: unknown[] }>) {
    let call = 0;
    return vi.spyOn(db, "select").mockImplementation(() => {
        const spec = specs[call] ?? {};
        call += 1;
        const chain = {
            from: () => chain,
            where: () => chain,
            groupBy: () => chain,
            get: () => spec.get,
            all: () => spec.all ?? [],
        };
        return chain as unknown as ReturnType<typeof db.select>;
    });
}

describe("stats service", () => {
    beforeEach(() => resetDb());

    describe("getOverview", () => {
        it("returns an all-zero overview when there are no logs", () => {
            const user = seedUser();
            const dto = getOverview(toSessionUser(user), { days: 7 });

            expect(dto.days).toBe(7);
            expect(dto.trend).toHaveLength(7);
            expect(dto.trend.every((t) => t.requests === 0 && t.prompt_tokens === 0 && t.completion_tokens === 0 && t.total_tokens === 0 && t.failed === 0)).toBe(true);
            expect(dto.by_capability).toEqual([]);
            expect(dto.by_model).toEqual([]);
            expect(dto.trend_by_model).toEqual([]);
            expect(dto.trend_models).toEqual([]);
            expect(dto.totals).toEqual({
                requests: 0,
                completed: 0,
                failed: 0,
                pending: 0,
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                avg_first_token_latency_ms: null,
                avg_total_latency_ms: null,
            });
            expect(dto.window_end).toBe(dto.window_end.slice(0, 10)); // sanity: YYYY-MM-DD shaped
        });

        it("aggregates totals/tokens/latency across multiple logs of mixed status in the window", () => {
            const user = seedUser();
            seedLog({ userId: user.id, status: "completed", promptTokens: 10, completionTokens: 20, totalTokens: 30, firstTokenLatencyMs: 100, totalLatencyMs: 400, createdAt: today() });
            seedLog({ userId: user.id, status: "completed", promptTokens: 5, completionTokens: 15, totalTokens: 20, firstTokenLatencyMs: 300, totalLatencyMs: 600, createdAt: today() });
            seedLog({ userId: user.id, status: "failed", promptTokens: 1, completionTokens: 0, totalTokens: 1, firstTokenLatencyMs: 200, totalLatencyMs: 500, createdAt: today() });

            const dto = getOverview(toSessionUser(user), { days: 1 });

            expect(dto.totals).toEqual({
                requests: 3,
                completed: 2,
                failed: 1,
                pending: 0,
                prompt_tokens: 16,
                completion_tokens: 35,
                total_tokens: 51,
                avg_first_token_latency_ms: 200, // (100+300+200)/3
                avg_total_latency_ms: 500, // (400+600+500)/3
            });
            expect(dto.trend).toHaveLength(1);
            expect(dto.trend[0]).toMatchObject({ requests: 3, failed: 1, prompt_tokens: 16, completion_tokens: 35, total_tokens: 51 });
        });

        it("counts pending logs separately from completed/failed", () => {
            const user = seedUser();
            seedLog({ userId: user.id, status: "pending", createdAt: today() });
            const dto = getOverview(toSessionUser(user), { days: 1 });
            expect(dto.totals.pending).toBe(1);
            expect(dto.totals.completed).toBe(0);
            expect(dto.totals.failed).toBe(0);
        });

        it("coalesces null token-count columns to 0 in totals and trend rather than propagating SQL NULL", () => {
            const user = seedUser();
            const log = seedLog({ userId: user.id, createdAt: today() });
            // seedLog's own `?? 10` defaults would coalesce an explicit null
            // override away, so force genuinely-null columns via a raw update.
            db.update(schema.generationLogs)
                .set({ promptTokens: null, completionTokens: null, totalTokens: null })
                .where(eq(schema.generationLogs.id, log.id))
                .run();

            const dto = getOverview(toSessionUser(user), { days: 1 });
            expect(dto.totals.requests).toBe(1);
            expect(dto.totals.prompt_tokens).toBe(0);
            expect(dto.totals.completion_tokens).toBe(0);
            expect(dto.totals.total_tokens).toBe(0);
            expect(dto.trend[0]).toMatchObject({ requests: 1, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
            expect(dto.by_model[0]).toMatchObject({ total_tokens: 0 });
            expect(dto.by_capability[0]).toMatchObject({ total_tokens: 0 });
        });

        it("zero-fills days without any logs at the correct trend position", () => {
            const user = seedUser();
            const threeDaysAgo = new Date();
            threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 2);
            seedLog({ userId: user.id, createdAt: threeDaysAgo.toISOString() });

            const dto = getOverview(toSessionUser(user), { days: 3 });
            expect(dto.trend).toHaveLength(3);
            // Oldest day (index 0) has the seeded log; the other two are blank.
            expect(dto.trend[0].requests).toBe(1);
            expect(dto.trend[1].requests).toBe(0);
            expect(dto.trend[2].requests).toBe(0);
        });

        it("excludes soft-deleted logs from every aggregate", () => {
            const user = seedUser();
            seedLog({ userId: user.id, createdAt: today() });
            seedLog({ userId: user.id, createdAt: today(), isDeleted: true });
            const dto = getOverview(toSessionUser(user), { days: 1 });
            expect(dto.totals.requests).toBe(1);
        });

        it("excludes logs outside the requested day window", () => {
            const user = seedUser();
            const longAgo = new Date();
            longAgo.setUTCDate(longAgo.getUTCDate() - 30);
            seedLog({ userId: user.id, createdAt: longAgo.toISOString() });
            const dto = getOverview(toSessionUser(user), { days: 7 });
            expect(dto.totals.requests).toBe(0);
        });

        describe("ownership scoping", () => {
            it("scopes a non-admin user's overview to their own logs, ignoring any user_id filter they pass", () => {
                const alice = seedUser({ username: "alice" });
                const bob = seedUser({ username: "bob" });
                seedLog({ userId: alice.id, createdAt: today() });
                seedLog({ userId: alice.id, createdAt: today() });
                seedLog({ userId: bob.id, createdAt: today() });

                const dto = getOverview(toSessionUser(alice), { days: 1, user_id: bob.id });
                expect(dto.totals.requests).toBe(2);
            });

            it("lets an admin without user_id see every user's logs", () => {
                const alice = seedUser({ username: "alice" });
                const bob = seedUser({ username: "bob" });
                const admin = seedAdmin({ username: "root" });
                seedLog({ userId: alice.id, createdAt: today() });
                seedLog({ userId: alice.id, createdAt: today() });
                seedLog({ userId: bob.id, createdAt: today() });

                const dto = getOverview(toSessionUser(admin), { days: 1 });
                expect(dto.totals.requests).toBe(3);
            });

            it("lets an admin with user_id scope to that specific user", () => {
                const alice = seedUser({ username: "alice" });
                const bob = seedUser({ username: "bob" });
                const admin = seedAdmin({ username: "root" });
                seedLog({ userId: alice.id, createdAt: today() });
                seedLog({ userId: bob.id, createdAt: today() });

                const dto = getOverview(toSessionUser(admin), { days: 1, user_id: bob.id });
                expect(dto.totals.requests).toBe(1);
            });
        });

        describe("by_capability", () => {
            it("groups and sorts by request count descending", () => {
                const user = seedUser();
                seedLog({ userId: user.id, capability: "chat", totalTokens: 10, createdAt: today() });
                seedLog({ userId: user.id, capability: "chat", totalTokens: 20, createdAt: today() });
                seedLog({ userId: user.id, capability: "embedding", totalTokens: 5, createdAt: today() });

                const dto = getOverview(toSessionUser(user), { days: 1 });
                expect(dto.by_capability).toEqual([
                    { key: "chat", label: "chat", requests: 2, total_tokens: 30 },
                    { key: "embedding", label: "embedding", requests: 1, total_tokens: 5 },
                ]);
            });

            it("falls back to 'unknown' when a log's capability column is genuinely null", () => {
                const user = seedUser();
                const log = seedLog({ userId: user.id, createdAt: today() });
                // seedLog's own `overrides.capability ?? "chat"` would coalesce an
                // explicit null away, so force it via a raw update instead.
                db.update(schema.generationLogs).set({ capability: null }).where(eq(schema.generationLogs.id, log.id)).run();

                const dto = getOverview(toSessionUser(user), { days: 1 });
                expect(dto.by_capability).toEqual([{ key: "unknown", label: "unknown", requests: 1, total_tokens: 30 }]);
            });
        });

        describe("by_model / trend_by_model top-N bucketing", () => {
            it("limits by_model to the top 8 by request count, aggregating the rest into an _other trend bucket", () => {
                const user = seedUser();
                // model-0 gets 10 requests, model-1 gets 9, ... model-9 gets 1.
                for (let i = 0; i < 10; i++) {
                    const requests = 10 - i;
                    for (let j = 0; j < requests; j++) {
                        seedLog({ userId: user.id, modelName: `model-${i}`, createdAt: today() });
                    }
                }

                const dto = getOverview(toSessionUser(user), { days: 1 });
                expect(dto.by_model).toHaveLength(8);
                expect(dto.by_model.map((b) => b.key)).toEqual([
                    "model-0", "model-1", "model-2", "model-3", "model-4", "model-5", "model-6", "model-7",
                ]);
                expect(dto.trend_models).toEqual([
                    "model-0", "model-1", "model-2", "model-3", "model-4", "model-5", "model-6", "model-7", "_other",
                ]);
                const otherPoint = dto.trend_by_model.find((p) => p.model === "_other");
                expect(otherPoint?.requests).toBe(2 + 1); // model-8 (2) + model-9 (1)
            });

            it("omits the _other bucket entirely when there are 8 or fewer distinct models", () => {
                const user = seedUser();
                seedLog({ userId: user.id, modelName: "only-model", createdAt: today() });

                const dto = getOverview(toSessionUser(user), { days: 1 });
                expect(dto.by_model).toEqual([{ key: "only-model", label: "only-model", requests: 1, total_tokens: 30 }]);
                expect(dto.trend_models).toEqual(["only-model"]);
                expect(dto.trend_by_model).toEqual([{ day: dto.trend_by_model[0].day, model: "only-model", requests: 1 }]);
            });
        });
    });

    describe("getModelStats", () => {
        it("returns null catalog meta when the model no longer exists (deleted from the catalog)", async () => {
            const user = seedUser();
            seedLog({ userId: user.id, modelName: "ghost-model", createdAt: today() });

            const dto = await getModelStats(toSessionUser(user), "ghost-model", { days: 1 });
            expect(dto.model_name).toBe("ghost-model");
            expect(dto.provider).toBeNull();
            expect(dto.capability).toBeNull();
            expect(dto.description).toBeNull();
            expect(dto.context_window).toBeNull();
            expect(dto.max_tokens).toBeNull();
            expect(dto.totals.requests).toBe(1);
        });

        it("resolves provider/capability/description/context_window/max_tokens from the live catalog", async () => {
            const user = seedUser();
            // enabled: false short-circuits discovery entirely — no fetch needed.
            const p = seedProvider({ name: "acme", enabled: false });
            seedModel({
                providerId: p.id,
                name: "acme-model",
                type: "embedding",
                description: "an embedding model",
                contextWindow: 8192,
                maxTokens: 2048,
            });
            seedLog({ userId: user.id, modelName: "acme-model", createdAt: today() });

            const dto = await getModelStats(toSessionUser(user), "acme-model", { days: 1 });
            expect(dto.provider).toBe("acme");
            expect(dto.capability).toBe("embedding");
            expect(dto.description).toBe("an embedding model");
            expect(dto.context_window).toBe(8192);
            expect(dto.max_tokens).toBe(2048);
        });

        it("leaves description/context_window/max_tokens null when the catalog model has none set", async () => {
            const user = seedUser();
            const p = seedProvider({ name: "bare", enabled: false });
            seedModel({ providerId: p.id, name: "bare-model" }); // description/context_window/max_tokens all default to null
            seedLog({ userId: user.id, modelName: "bare-model", createdAt: today() });

            const dto = await getModelStats(toSessionUser(user), "bare-model", { days: 1 });
            expect(dto.description).toBeNull();
            expect(dto.context_window).toBeNull();
            expect(dto.max_tokens).toBeNull();
        });

        it("scopes totals/trend to the exact model name, excluding other models' logs", async () => {
            const user = seedUser();
            seedLog({ userId: user.id, modelName: "model-a", createdAt: today() });
            seedLog({ userId: user.id, modelName: "model-a", createdAt: today() });
            seedLog({ userId: user.id, modelName: "model-b", createdAt: today() });

            const dto = await getModelStats(toSessionUser(user), "model-a", { days: 1 });
            expect(dto.totals.requests).toBe(2);
        });

        it("computes per-day trend detail including failed count and average latencies", async () => {
            const user = seedUser();
            seedLog({ userId: user.id, modelName: "m", status: "completed", firstTokenLatencyMs: 100, totalLatencyMs: 300, createdAt: today() });
            seedLog({ userId: user.id, modelName: "m", status: "failed", firstTokenLatencyMs: 200, totalLatencyMs: 500, createdAt: today() });

            const dto = await getModelStats(toSessionUser(user), "m", { days: 1 });
            expect(dto.trend).toHaveLength(1);
            expect(dto.trend[0]).toMatchObject({
                requests: 2,
                failed: 1,
                avg_first_token_latency_ms: 150,
                avg_total_latency_ms: 400,
            });
        });

        it("zero-fills trend days with no matching-model logs, including null averages", async () => {
            const user = seedUser();
            const dto = await getModelStats(toSessionUser(user), "never-logged", { days: 2 });
            expect(dto.trend).toHaveLength(2);
            expect(dto.trend.every((t) => t.requests === 0 && t.avg_first_token_latency_ms === null && t.avg_total_latency_ms === null)).toBe(true);
        });

        it("coalesces null token-count columns to 0 in totals and trend rather than propagating SQL NULL", async () => {
            const user = seedUser();
            const log = seedLog({ userId: user.id, modelName: "m", createdAt: today() });
            db.update(schema.generationLogs)
                .set({ promptTokens: null, completionTokens: null, totalTokens: null })
                .where(eq(schema.generationLogs.id, log.id))
                .run();

            const dto = await getModelStats(toSessionUser(user), "m", { days: 1 });
            expect(dto.totals.prompt_tokens).toBe(0);
            expect(dto.totals.completion_tokens).toBe(0);
            expect(dto.totals.total_tokens).toBe(0);
            expect(dto.trend[0]).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        });

        it("reports a null (not zero) per-day average latency when every log that day lacks a latency value", async () => {
            const user = seedUser();
            const log = seedLog({ userId: user.id, modelName: "m", createdAt: today() });
            // AVG() over an all-NULL column is SQL NULL, distinct from AVG over
            // zero rows entirely — this day still has 1 request.
            db.update(schema.generationLogs)
                .set({ firstTokenLatencyMs: null, totalLatencyMs: null })
                .where(eq(schema.generationLogs.id, log.id))
                .run();

            const dto = await getModelStats(toSessionUser(user), "m", { days: 1 });
            expect(dto.trend[0].requests).toBe(1);
            expect(dto.trend[0].avg_first_token_latency_ms).toBeNull();
            expect(dto.trend[0].avg_total_latency_ms).toBeNull();
        });

        describe("ownership scoping", () => {
            it("scopes a non-admin user to their own logs, ignoring any user_id filter they pass", async () => {
                const alice = seedUser({ username: "alice" });
                const bob = seedUser({ username: "bob" });
                seedLog({ userId: alice.id, modelName: "shared-model", createdAt: today() });
                seedLog({ userId: bob.id, modelName: "shared-model", createdAt: today() });

                const dto = await getModelStats(toSessionUser(alice), "shared-model", { days: 1, user_id: bob.id });
                expect(dto.totals.requests).toBe(1);
            });

            it("lets an admin without user_id see every user's logs for that model", async () => {
                const alice = seedUser({ username: "alice" });
                const bob = seedUser({ username: "bob" });
                const admin = seedAdmin({ username: "root" });
                seedLog({ userId: alice.id, modelName: "shared-model", createdAt: today() });
                seedLog({ userId: bob.id, modelName: "shared-model", createdAt: today() });

                const dto = await getModelStats(toSessionUser(admin), "shared-model", { days: 1 });
                expect(dto.totals.requests).toBe(2);
            });

            it("lets an admin with user_id scope to that specific user", async () => {
                const alice = seedUser({ username: "alice" });
                const bob = seedUser({ username: "bob" });
                const admin = seedAdmin({ username: "root" });
                seedLog({ userId: alice.id, modelName: "shared-model", createdAt: today() });
                seedLog({ userId: bob.id, modelName: "shared-model", createdAt: today() });

                const dto = await getModelStats(toSessionUser(admin), "shared-model", { days: 1, user_id: bob.id });
                expect(dto.totals.requests).toBe(1);
            });
        });
    });

    describe("defensive coalescing against a malformed DB layer", () => {
        // These branches (`totalsRow?.x ?? 0` where `totalsRow` itself, or a
        // field on a grouped row, is null/undefined) are unreachable through
        // real seeding: SQLite's COUNT/COALESCE(SUM(...),0) never return null,
        // and an aggregate query always yields exactly one row (ungrouped) or
        // a row per distinct group value — never a missing row. Mocking the
        // `db.select` chain is the only way to prove the DTO still coerces to
        // 0/"unknown"/null instead of leaking null/NaN if that invariant were
        // ever violated (e.g. a future schema/driver change).
        it("getOverview coerces every totals/trend/by_capability/by_model field to 0 when the underlying rows are missing fields, and drops a trend_by_model row that matches neither the top-N set nor an _other bucket", () => {
            const user = seedUser();
            const day = today().slice(0, 10);

            const spy = mockSelectSequence(
                {}, // totalsRow: `.get()` resolves to undefined entirely
                { all: [{ day, requests: null, promptTokens: null, completionTokens: undefined, totalTokens: null, failed: null }] }, // trendRows
                { all: [{ key: "chat", requests: null, totalTokens: null }] }, // capRows
                { all: [{ key: "m1", requests: null, totalTokens: null }] }, // modelRows: 1 distinct model => hasOther=false
                {
                    all: [
                        { day, model: "m1", requests: null }, // in the top set; requests null -> coalesced to 0
                        { day, model: "m2", requests: 5 }, // NOT in the top set, and hasOther is false -> silently dropped
                    ],
                }
            );

            try {
                const dto = getOverview(toSessionUser(user), { days: 1 });

                expect(dto.totals).toEqual({
                    requests: 0,
                    completed: 0,
                    failed: 0,
                    pending: 0,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                    avg_first_token_latency_ms: null,
                    avg_total_latency_ms: null,
                });
                expect(dto.trend[0]).toEqual({ day, requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, failed: 0 });
                expect(dto.by_capability).toEqual([{ key: "chat", label: "chat", requests: 0, total_tokens: 0 }]);
                expect(dto.by_model).toEqual([{ key: "m1", label: "m1", requests: 0, total_tokens: 0 }]);
                // hasOther is false (1 distinct model <= the top-8 cap), so
                // m2's stray row is neither promoted into trend_by_model nor
                // folded into `_other` — it is dropped on the floor.
                expect(dto.trend_by_model).toEqual([{ day, model: "m1", requests: 0 }]);
                expect(dto.trend_models).toEqual(["m1"]);
            } finally {
                spy.mockRestore();
            }
        });

        it("getOverview folds a stray trend_by_model row into the _other bucket when hasOther is true", () => {
            const user = seedUser();
            const day = today().slice(0, 10);

            // 9 distinct models => by_model caps at 8 => hasOther = true.
            const modelRows = Array.from({ length: 9 }, (_, i) => ({ key: `m${i}`, requests: 9 - i, totalTokens: 0 }));

            const spy = mockSelectSequence(
                { get: { requests: 9, completed: 9, failed: 0, pending: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, avgFirst: null, avgTotal: null } },
                { all: [] }, // trendRows
                { all: [] }, // capRows
                { all: modelRows },
                { all: [{ day, model: "m8", requests: 7 }] } // m8 is the 9th model, outside the top-8 -> _other
            );

            try {
                const dto = getOverview(toSessionUser(user), { days: 1 });
                expect(dto.by_model).toHaveLength(8);
                expect(dto.trend_models).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "_other"]);
                expect(dto.trend_by_model).toEqual([{ day, model: "_other", requests: 7 }]);
            } finally {
                spy.mockRestore();
            }
        });

        it("getOverview zero-fills the trend to the correct length when every db.select call reports empty rows", () => {
            const user = seedUser();
            const spy = mockSelectSequence(
                {}, // totalsRow undefined
                { all: [] },
                { all: [] },
                { all: [] },
                { all: [] }
            );

            try {
                const dto = getOverview(toSessionUser(user), { days: 4 });
                expect(dto.trend).toHaveLength(4);
                expect(dto.trend.every((t) => t.requests === 0 && t.prompt_tokens === 0 && t.completion_tokens === 0 && t.total_tokens === 0 && t.failed === 0)).toBe(true);
                expect(dto.by_capability).toEqual([]);
                expect(dto.by_model).toEqual([]);
                expect(dto.trend_by_model).toEqual([]);
                expect(dto.trend_models).toEqual([]);
            } finally {
                spy.mockRestore();
            }
        });

        it("getModelStats coerces requests/prompt_tokens/completion_tokens/total_tokens to 0 when totals/trend rows are entirely missing", async () => {
            const user = seedUser();
            const day = today().slice(0, 10);
            vi.mocked(listAllModels).mockResolvedValueOnce([]);

            const spy = mockSelectSequence(
                {}, // totalsRow undefined
                { all: [{ day, requests: undefined, failed: null, promptTokens: null, completionTokens: undefined, totalTokens: null, avgFirst: null, avgTotal: null }] }
            );

            try {
                const dto = await getModelStats(toSessionUser(user), "whatever-model", { days: 1 });

                expect(dto.totals).toEqual({
                    requests: 0,
                    completed: 0,
                    failed: 0,
                    pending: 0,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                    avg_first_token_latency_ms: null,
                    avg_total_latency_ms: null,
                });
                expect(dto.trend[0]).toEqual({
                    day,
                    requests: 0,
                    failed: 0,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                    avg_first_token_latency_ms: null,
                    avg_total_latency_ms: null,
                });
            } finally {
                spy.mockRestore();
            }
        });

        it("getModelStats falls back to null provider/capability when a resolved catalog entry is missing those fields", async () => {
            const user = seedUser();
            seedLog({ userId: user.id, modelName: "weird-model", createdAt: today() });
            vi.mocked(listAllModels).mockResolvedValueOnce([
                {
                    name: "weird-model",
                    provider: undefined,
                    type: undefined,
                    description: "has a description",
                    context_window: null,
                    max_tokens: null,
                } as unknown as Awaited<ReturnType<typeof listAllModels>>[number],
            ]);

            const dto = await getModelStats(toSessionUser(user), "weird-model", { days: 1 });
            expect(dto.provider).toBeNull();
            expect(dto.capability).toBeNull();
            expect(dto.description).toBe("has a description");
        });
    });
});
