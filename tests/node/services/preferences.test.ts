import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { defaultUserPreferences } from "@/lib/schemas/preferences";
import { getPreferences, updatePreferences } from "@/lib/server/preferences";
import { resetDb, seedUser } from "../../helpers/db";

describe("preferences service", () => {
    beforeEach(() => resetDb());

    describe("getPreferences", () => {
        it("returns all defaults when the user has no stored row", () => {
            const user = seedUser({ username: "fresh" });
            expect(getPreferences(user.id)).toEqual(defaultUserPreferences);
        });

        it("merges a partial stored row over the defaults", () => {
            const user = seedUser({ username: "partial" });
            db.insert(schema.userPreferences).values({
                userId: user.id,
                preferences: { user_name: "Ada", theme_scheme: "dark" },
                updatedAt: new Date().toISOString(),
            }).run();

            const prefs = getPreferences(user.id);
            expect(prefs.user_name).toBe("Ada");
            expect(prefs.theme_scheme).toBe("dark");
            // Everything else still comes from defaults.
            expect(prefs.default_history_limit).toBe(defaultUserPreferences.default_history_limit);
            expect(prefs.theme_id).toBe(defaultUserPreferences.theme_id);
            expect(prefs.mcp_auto_check_interval_minutes).toBe(defaultUserPreferences.mcp_auto_check_interval_minutes);
        });

        it("fills in a key that a legacy stored row never had (forward-compatible default)", () => {
            const user = seedUser({ username: "legacy" });
            // Simulate a row persisted before `provider_auto_check_interval_minutes`
            // existed at all — the stored JSON simply lacks the key.
            db.insert(schema.userPreferences).values({
                userId: user.id,
                preferences: { theme_id: "aurora" },
                updatedAt: new Date().toISOString(),
            }).run();

            const prefs = getPreferences(user.id);
            expect(prefs.theme_id).toBe("aurora");
            expect(prefs.provider_auto_check_interval_minutes).toBe(
                defaultUserPreferences.provider_auto_check_interval_minutes,
            );
            expect(prefs.mcp_auto_check_interval_minutes).toBe(defaultUserPreferences.mcp_auto_check_interval_minutes);
        });

        it("salvages per-field: an out-of-range legacy value falls back to default while sibling fields survive", () => {
            const user = seedUser({ username: "salvage" });
            // `default_history_limit` used to allow up to 100; the schema
            // later tightened the max to 50. A pre-existing row can still
            // hold the old, now-invalid value.
            db.insert(schema.userPreferences).values({
                userId: user.id,
                preferences: { default_history_limit: 100, user_name: "Grace" },
                updatedAt: new Date().toISOString(),
            }).run();

            const prefs = getPreferences(user.id);
            expect(prefs.default_history_limit).toBe(defaultUserPreferences.default_history_limit);
            expect(prefs.user_name).toBe("Grace");
        });

        it("salvages an invalid enum value back to default while other fields are unaffected", () => {
            const user = seedUser({ username: "salvage-enum" });
            db.insert(schema.userPreferences).values({
                userId: user.id,
                preferences: { chat_render_mode: "not-a-real-mode", typewriter_cps: 120 },
                updatedAt: new Date().toISOString(),
            }).run();

            const prefs = getPreferences(user.id);
            expect(prefs.chat_render_mode).toBe(defaultUserPreferences.chat_render_mode);
            expect(prefs.typewriter_cps).toBe(120);
        });

        it("always returns a value satisfying the schema even when the entire stored blob is garbage", () => {
            const user = seedUser({ username: "garbage" });
            db.insert(schema.userPreferences).values({
                userId: user.id,
                preferences: { default_model: 12345, theme_scheme: "purple", typewriter_cps: -5 },
                updatedAt: new Date().toISOString(),
            }).run();

            const prefs = getPreferences(user.id);
            expect(prefs).toEqual(defaultUserPreferences);
        });
    });

    describe("updatePreferences", () => {
        it("creates a row on first patch and only changes the patched fields", () => {
            const user = seedUser({ username: "patcher" });
            const result = updatePreferences(user.id, { user_name: "Linus" });
            expect(result.user_name).toBe("Linus");
            expect(result.theme_id).toBe(defaultUserPreferences.theme_id);

            const row = db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id)).get();
            expect(row).toBeTruthy();
        });

        it("merges successive patches without clobbering unrelated fields (upsert, not duplicate rows)", () => {
            const user = seedUser({ username: "multi-patcher" });
            updatePreferences(user.id, { user_name: "Ada" });
            const second = updatePreferences(user.id, { theme_scheme: "dark" });

            expect(second.user_name).toBe("Ada");
            expect(second.theme_scheme).toBe("dark");

            const rows = db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id)).all();
            expect(rows).toHaveLength(1);
        });

        it("returns the merged DTO that getPreferences will subsequently also return", () => {
            const user = seedUser({ username: "consistent" });
            const updated = updatePreferences(user.id, { default_history_limit: 25 });
            const fetched = getPreferences(user.id);
            expect(fetched).toEqual(updated);
            expect(fetched.default_history_limit).toBe(25);
        });

        it("scopes preferences per user (no cross-user leakage)", () => {
            const alice = seedUser({ username: "alice-prefs" });
            const bob = seedUser({ username: "bob-prefs" });
            updatePreferences(alice.id, { user_name: "Alice" });
            updatePreferences(bob.id, { user_name: "Bob" });

            expect(getPreferences(alice.id).user_name).toBe("Alice");
            expect(getPreferences(bob.id).user_name).toBe("Bob");
        });

        it("heals a previously-salvaged out-of-range field once a valid patch is applied for it", () => {
            const user = seedUser({ username: "healer" });
            db.insert(schema.userPreferences).values({
                userId: user.id,
                preferences: { default_history_limit: 999 },
                updatedAt: new Date().toISOString(),
            }).run();
            expect(getPreferences(user.id).default_history_limit).toBe(defaultUserPreferences.default_history_limit);

            const updated = updatePreferences(user.id, { default_history_limit: 30 });
            expect(updated.default_history_limit).toBe(30);
        });
    });
});
