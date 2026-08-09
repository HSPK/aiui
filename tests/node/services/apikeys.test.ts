import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { HttpError } from "@/lib/server/response";
import { createUserApiKey, deleteUserApiKey, listApiKeys } from "@/lib/server/apikeys";
import { sha256 } from "@/lib/server/crypto";
import { resetDb, seedUser } from "../../helpers/db";

describe("apikeys service", () => {
    beforeEach(() => resetDb());

    describe("createUserApiKey", () => {
        it("returns the plaintext key exactly once, with the sk-loom- prefix", () => {
            const user = seedUser({ username: "alice" });
            const dto = createUserApiKey(user.id, { name: "my key" });

            expect(dto.key).toMatch(/^sk-loom-/);
            expect(dto.prefix).toBe(dto.key.slice(0, 12));
            expect(dto.name).toBe("my key");
            expect(dto.last_used_at).toBeNull();
            expect(dto.expires_at).toBeNull();
            expect(typeof dto.id).toBe("string");
            expect(dto.created_at).toEqual(expect.any(String));
        });

        it("trims the name before persisting", () => {
            const user = seedUser({ username: "trimmer" });
            const dto = createUserApiKey(user.id, { name: "  padded name  " });
            expect(dto.name).toBe("padded name");
            const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, dto.id)).get()!;
            expect(row.name).toBe("padded name");
        });

        it("never stores the plaintext key — only a hash — and the stored hash matches sha256(plaintext)", () => {
            const user = seedUser({ username: "bob" });
            const dto = createUserApiKey(user.id, { name: "secure key" });
            const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, dto.id)).get()!;

            expect(row.keyHash).not.toBe(dto.key);
            expect(row.keyHash).not.toContain(dto.key);
            expect(row.keyHash).toHaveLength(64); // hex sha256
            expect(row.keyHash).toBe(sha256(dto.key));
        });

        it("stores a null expiry by default and an explicit one when supplied", () => {
            const user = seedUser({ username: "expiry-user" });
            const noExpiry = createUserApiKey(user.id, { name: "forever" });
            expect(noExpiry.expires_at).toBeNull();

            const isoExpiry = "2030-01-01T00:00:00.000Z";
            const withExpiry = createUserApiKey(user.id, { name: "temp", expires_at: isoExpiry });
            expect(withExpiry.expires_at).toBe(isoExpiry);
        });

        it("scopes newly created keys to the given user id", () => {
            const alice = seedUser({ username: "alice2" });
            const bob = seedUser({ username: "bob2" });
            createUserApiKey(alice.id, { name: "alice-key" });
            createUserApiKey(bob.id, { name: "bob-key" });

            const aliceRow = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, alice.id)).all();
            const bobRow = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, bob.id)).all();
            expect(aliceRow).toHaveLength(1);
            expect(bobRow).toHaveLength(1);
            expect(aliceRow[0].name).toBe("alice-key");
        });
    });

    describe("listApiKeys", () => {
        it("returns an empty list for a user with no keys", () => {
            const user = seedUser({ username: "lonely" });
            expect(listApiKeys(user.id)).toEqual([]);
        });

        it("only returns keys belonging to the requested user", () => {
            const alice = seedUser({ username: "alice3" });
            const bob = seedUser({ username: "bob3" });
            createUserApiKey(alice.id, { name: "alice-only" });
            createUserApiKey(bob.id, { name: "bob-only" });

            const aliceKeys = listApiKeys(alice.id);
            expect(aliceKeys).toHaveLength(1);
            expect(aliceKeys[0].name).toBe("alice-only");
        });

        it("never includes the plaintext key or the hash in the list DTO", () => {
            const user = seedUser({ username: "shape-check" });
            createUserApiKey(user.id, { name: "shaped" });
            const [dto] = listApiKeys(user.id);
            expect(dto).not.toHaveProperty("key");
            expect(dto).not.toHaveProperty("keyHash");
            expect(dto).not.toHaveProperty("key_hash");
            expect(Object.keys(dto).sort()).toEqual(
                ["created_at", "expires_at", "id", "last_used_at", "name", "prefix"].sort(),
            );
        });

        it("orders results newest-first by created_at", () => {
            const user = seedUser({ username: "orderer" });
            db.insert(schema.apiKeys).values({
                id: "key-old",
                userId: user.id,
                name: "older",
                prefix: "sk-loom-old",
                keyHash: "hash-old",
                createdAt: "2024-01-01T00:00:00.000Z",
            }).run();
            db.insert(schema.apiKeys).values({
                id: "key-new",
                userId: user.id,
                name: "newer",
                prefix: "sk-loom-new",
                keyHash: "hash-new",
                createdAt: "2024-06-01T00:00:00.000Z",
            }).run();

            const keys = listApiKeys(user.id);
            expect(keys.map((k) => k.name)).toEqual(["newer", "older"]);
        });
    });

    describe("deleteUserApiKey", () => {
        it("deletes a key owned by the caller", () => {
            const user = seedUser({ username: "deleter" });
            const dto = createUserApiKey(user.id, { name: "to-delete" });
            deleteUserApiKey(user.id, dto.id);
            expect(db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, dto.id)).get()).toBeUndefined();
        });

        it("throws 404 for a key id that doesn't exist", () => {
            const user = seedUser({ username: "deleter2" });
            expect(() => deleteUserApiKey(user.id, "nonexistent-id")).toThrow(HttpError);
            try {
                deleteUserApiKey(user.id, "nonexistent-id");
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("enforces ownership: a different user cannot delete someone else's key (404, key survives)", () => {
            const owner = seedUser({ username: "owner" });
            const attacker = seedUser({ username: "attacker" });
            const dto = createUserApiKey(owner.id, { name: "owners-key" });

            expect(() => deleteUserApiKey(attacker.id, dto.id)).toThrow(HttpError);
            try {
                deleteUserApiKey(attacker.id, dto.id);
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
            // Critically: the key must still exist afterwards — the attacker's
            // attempt must not have deleted another user's row.
            expect(db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, dto.id)).get()).toBeTruthy();
        });
    });
});
