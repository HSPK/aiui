import { beforeEach, describe, expect, it } from "vitest";
import type { Tool } from "@/lib/server/db/schema";
import { HttpError } from "@/lib/server/response";
import { createTool, deleteTool, getTool, listTools, updateTool } from "@/lib/server/tools";
import { serializeTool } from "@/lib/server/tools/serializer";
import { resetDb, seedTool } from "../../helpers/db";

describe("tools service", () => {
    beforeEach(() => resetDb());

    describe("createTool", () => {
        it("creates a tool with defaults applied", () => {
            const dto = createTool({ name: "search_web" });
            expect(dto.name).toBe("search_web");
            expect(dto.description).toBe("");
            expect(dto.parameters).toEqual({});
            expect(dto.webhook_url).toBeNull();
            expect(dto.enabled).toBe(true);
            expect(dto.id).toEqual(expect.any(String));
            expect(dto.created_at).toEqual(expect.any(String));
        });

        it("stores provided description/parameters/webhook_url/enabled", () => {
            const dto = createTool({
                name: "custom_tool",
                description: "does a thing",
                parameters: { type: "object", properties: { q: { type: "string" } } },
                webhook_url: "https://example.com/hook",
                enabled: false,
            });
            expect(dto.description).toBe("does a thing");
            expect(dto.parameters).toEqual({ type: "object", properties: { q: { type: "string" } } });
            expect(dto.webhook_url).toBe("https://example.com/hook");
            expect(dto.enabled).toBe(false);
        });

        it("trims the name before storing and checking uniqueness", () => {
            const dto = createTool({ name: "  padded_name  " });
            expect(dto.name).toBe("padded_name");
        });

        it("rejects a duplicate tool name with 400", () => {
            createTool({ name: "dup_tool" });
            expect(() => createTool({ name: "dup_tool" })).toThrow(HttpError);
            try {
                createTool({ name: "dup_tool" });
            } catch (err) {
                expect((err as HttpError).status).toBe(400);
                expect((err as HttpError).message).toContain("already exists");
            }
        });
    });

    describe("listTools", () => {
        it("returns an empty list when there are no tools", () => {
            expect(listTools()).toEqual([]);
        });

        it("lists all tools ordered by name", () => {
            seedTool({ name: "zeta" });
            seedTool({ name: "alpha" });
            seedTool({ name: "mid" });
            expect(listTools().map((t) => t.name)).toEqual(["alpha", "mid", "zeta"]);
        });
    });

    describe("getTool", () => {
        it("gets a tool by id", () => {
            const tool = seedTool({ name: "by-id" });
            expect(getTool(tool.id).name).toBe("by-id");
        });

        it("gets a tool by name", () => {
            seedTool({ name: "by-name" });
            expect(getTool("by-name").name).toBe("by-name");
        });

        it("throws 404 for an unknown id/name", () => {
            expect(() => getTool("nonexistent")).toThrow(HttpError);
            try {
                getTool("nonexistent");
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("serializes a genuinely-null/undefined parameters field down to an empty object", () => {
            // The `parameters` column is NOT NULL at the DB level (default
            // `{}`), so createTool/updateTool can never persist a null value
            // and a real row can never come back null either — the only way
            // to exercise the serializer's own defensive `t.parameters ?? {}`
            // fallback is to hand-build a row shape that violates that
            // invariant, bypassing the DB (and the service layer) entirely.
            const row = {
                id: "fake-id",
                name: "fake-tool",
                description: "d",
                parameters: null,
                webhookUrl: null,
                enabled: true,
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
            } as unknown as Tool;

            expect(serializeTool(row).parameters).toEqual({});
        });
    });

    describe("updateTool", () => {
        it("updates individual fields without touching the others", () => {
            const tool = seedTool({ name: "orig", description: "orig-desc", enabled: true });
            const dto = updateTool(tool.id, { description: "new-desc" });
            expect(dto.name).toBe("orig");
            expect(dto.description).toBe("new-desc");
            expect(dto.enabled).toBe(true);
        });

        it("renames a tool when the new name is unique", () => {
            const tool = seedTool({ name: "old-name" });
            const dto = updateTool(tool.id, { name: "new-name" });
            expect(dto.name).toBe("new-name");
        });

        it("allows 'renaming' to the same current name (no self-conflict)", () => {
            const tool = seedTool({ name: "steady" });
            const dto = updateTool(tool.id, { name: "steady" });
            expect(dto.name).toBe("steady");
        });

        it("rejects renaming to a name already used by another tool", () => {
            seedTool({ name: "taken" });
            const tool = seedTool({ name: "mine" });
            expect(() => updateTool(tool.id, { name: "taken" })).toThrow(HttpError);
            try {
                updateTool(tool.id, { name: "taken" });
            } catch (err) {
                expect((err as HttpError).status).toBe(400);
            }
        });

        it("rejects renaming to an empty (post-trim) name", () => {
            const tool = seedTool({ name: "has-a-name" });
            expect(() => updateTool(tool.id, { name: "   " })).toThrow(HttpError);
            try {
                updateTool(tool.id, { name: "   " });
            } catch (err) {
                expect((err as HttpError).status).toBe(400);
                expect((err as HttpError).message).toContain("empty");
            }
        });

        it("clears the webhook_url when explicitly set to null", () => {
            const tool = seedTool({ name: "hooked", webhookUrl: "https://example.com/hook" });
            const dto = updateTool(tool.id, { webhook_url: null });
            expect(dto.webhook_url).toBeNull();
        });

        it("toggles enabled off and on", () => {
            const tool = seedTool({ name: "toggle-me", enabled: true });
            expect(updateTool(tool.id, { enabled: false }).enabled).toBe(false);
            expect(updateTool(tool.id, { enabled: true }).enabled).toBe(true);
        });

        it("updates parameters wholesale", () => {
            const tool = seedTool({ name: "params-tool", parameters: { a: 1 } });
            const dto = updateTool(tool.id, { parameters: { b: 2 } });
            expect(dto.parameters).toEqual({ b: 2 });
        });

        it("normalizes an explicit null parameters diff down to an empty object", () => {
            const tool = seedTool({ name: "null-params-tool", parameters: { a: 1 } });
            const dto = updateTool(tool.id, { parameters: null as unknown as Record<string, unknown> });
            expect(dto.parameters).toEqual({});
        });

        it("throws 404 when the tool doesn't exist", () => {
            expect(() => updateTool("nonexistent", { description: "x" })).toThrow(HttpError);
            try {
                updateTool("nonexistent", { description: "x" });
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("resolves target by name as well as id", () => {
            seedTool({ name: "find-by-name" });
            const dto = updateTool("find-by-name", { description: "found" });
            expect(dto.description).toBe("found");
        });
    });

    describe("deleteTool", () => {
        it("deletes a tool by id", () => {
            const tool = seedTool({ name: "goner" });
            deleteTool(tool.id);
            expect(() => getTool(tool.id)).toThrow(HttpError);
        });

        it("deletes a tool by name", () => {
            seedTool({ name: "goner-by-name" });
            deleteTool("goner-by-name");
            expect(() => getTool("goner-by-name")).toThrow(HttpError);
        });

        it("throws 404 when the tool doesn't exist", () => {
            expect(() => deleteTool("nonexistent")).toThrow(HttpError);
            try {
                deleteTool("nonexistent");
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });
    });
});
