// Tests for the generation-log writers (`startLog` / `completeLog`) and
// their private sanitization helpers, exercised indirectly through the
// public functions' effect on the `generation_logs` row.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { completeLog, startLog } from "@/lib/server/gateway/log";
import { resetDb, seedUser } from "@/tests/helpers/db";

function getLogRow(id: string) {
    const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, id)).get();
    if (!row) throw new Error(`log row ${id} not found`);
    return row;
}

describe("startLog", () => {
    beforeEach(() => resetDb());

    it("inserts a pending row with the given fields and returns a fresh id", () => {
        const user = seedUser();
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
            inputSummary: "hi",
            conversationId: "conv-1",
            messageId: "msg-1",
        });

        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);

        const row = getLogRow(id);
        expect(row.userId).toBe(user.id);
        expect(row.modelName).toBe("gpt-4o-mini");
        expect(row.capability).toBe("chat");
        expect(row.status).toBe("pending");
        expect(row.inputSummary).toBe("hi");
        expect(row.conversationId).toBe("conv-1");
        expect(row.messageId).toBe("msg-1");
    });

    it("defaults conversationId/messageId to null when omitted", () => {
        const user = seedUser();
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: {},
            inputSummary: null,
        });
        const row = getLogRow(id);
        expect(row.conversationId).toBeNull();
        expect(row.messageId).toBeNull();
    });

    it("extractKwargs strips input-data keys (messages/input/image/mask/file/prompt/tools) but keeps sampling params", () => {
        const user = seedUser();
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: {
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: "hi" }],
                input: "should be stripped too",
                image: "b",
                mask: "m",
                file: "f",
                prompt: "p",
                tools: [{ type: "function", function: { name: "x" } }],
                temperature: 0.7,
                stream: true,
            },
            inputSummary: null,
        });
        const row = getLogRow(id);
        expect(row.generationKwargs).toEqual({ model: "gpt-4o-mini", temperature: 0.7, stream: true });
        // The full (sanitized) body is still kept under `input` for the UI accordion.
        expect((row.input as { messages: unknown }).messages).toEqual([{ role: "user", content: "hi" }]);
    });

    it("sanitizes a large data: URI nested anywhere in the body into a short marker", () => {
        const user = seedUser();
        const bigB64 = "A".repeat(3000);
        const dataUri = `data:image/png;base64,${bigB64}`;
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: {
                messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUri } }] }],
            },
            inputSummary: null,
        });
        const row = getLogRow(id);
        const storedUrl = (
            row.input as { messages: Array<{ content: Array<{ image_url: { url: string } }> }> }
        ).messages[0].content[0].image_url.url;
        expect(storedUrl).not.toContain(bigB64);
        expect(storedUrl).toMatch(/^\[base64 image image\/png, ~\d+ KB\]$/);
    });

    it("sanitizes a bare (non data:-prefixed) long base64-looking string", () => {
        const user = seedUser();
        const bareB64 = "A".repeat(3000);
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "audio.transcription",
            requestBody: { some_field: bareB64 },
            inputSummary: null,
        });
        const row = getLogRow(id);
        expect((row.input as { some_field: string }).some_field).toMatch(/^\[base64 blob, ~\d+ KB\]$/);
    });

    it("does not touch strings at/under the inline threshold", () => {
        const user = seedUser();
        const short = "hello world, this is a short string";
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: { note: short },
            inputSummary: null,
        });
        const row = getLogRow(id);
        expect((row.input as { note: string }).note).toBe(short);
    });

    it("a data: URI for a non-image mime collapses to a generic 'file' marker", () => {
        const user = seedUser();
        const bigB64 = "B".repeat(3000);
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: { file: `data:application/pdf;base64,${bigB64}` },
            inputSummary: null,
        });
        const row = getLogRow(id);
        expect((row.input as { file: string }).file).toMatch(/^\[base64 file application\/pdf, ~\d+ KB\]$/);
    });

    it("leaves non-string values (numbers, booleans, null, nested arrays) untouched", () => {
        const user = seedUser();
        const id = startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: { n: 42, flag: true, nothing: null, list: [1, 2, { a: "b" }] },
            inputSummary: null,
        });
        const row = getLogRow(id);
        expect(row.input).toEqual({ n: 42, flag: true, nothing: null, list: [1, 2, { a: "b" }] });
    });
});

describe("completeLog", () => {
    beforeEach(() => resetDb());

    function freshLogId(): string {
        const user = seedUser();
        return startLog({
            userId: user.id,
            modelName: "gpt-4o-mini",
            capability: "chat",
            requestBody: {},
            inputSummary: null,
        });
    }

    it("marks a row completed with full token/latency/generation fields", () => {
        const id = freshLogId();
        completeLog(id, {
            status: "completed",
            output: "hello back",
            generation: { id: "gen-1", choices: [] },
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            firstTokenLatencyMs: 123,
            totalLatencyMs: 456,
        });
        const row = getLogRow(id);
        expect(row.status).toBe("completed");
        expect(row.output).toBe("hello back");
        expect(row.reason).toBeNull();
        expect(row.generation).toEqual({ id: "gen-1", choices: [] });
        expect(row.promptTokens).toBe(10);
        expect(row.completionTokens).toBe(20);
        expect(row.totalTokens).toBe(30);
        expect(row.firstTokenLatencyMs).toBe(123);
        expect(row.totalLatencyMs).toBe(456);
    });

    it("marks a row failed with a reason and defaults every omitted optional field to null", () => {
        const id = freshLogId();
        completeLog(id, { status: "failed", reason: "Upstream HTTP 500" });
        const row = getLogRow(id);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("Upstream HTTP 500");
        expect(row.output).toBeNull();
        expect(row.generation).toBeNull();
        expect(row.promptTokens).toBeNull();
        expect(row.completionTokens).toBeNull();
        expect(row.totalTokens).toBeNull();
        expect(row.firstTokenLatencyMs).toBeNull();
        expect(row.totalLatencyMs).toBeNull();
    });

    it("explicit null output/reason are preserved as null (not coerced to another falsy value)", () => {
        const id = freshLogId();
        completeLog(id, { status: "completed", output: null, reason: null, totalLatencyMs: 10 });
        const row = getLogRow(id);
        expect(row.output).toBeNull();
        expect(row.reason).toBeNull();
        expect(row.totalLatencyMs).toBe(10);
    });
});
