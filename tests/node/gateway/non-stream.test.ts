// Direct unit tests for `handleNonStream` — the JSON / binary branch of
// forwardGeneration. A hand-written fake variant lets each test control
// exactly what `parseResponse` returns, isolating this file's own
// completeLog / artifact-persistence / passthrough logic from any real
// variant's parsing (covered by tests/node/upstream/variant-*.test.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { handleNonStream } from "@/lib/server/gateway/non-stream";
import { startLog } from "@/lib/server/gateway/log";
import type { NormalizedNonStreamResult, UpstreamApiVariant, VariantContext } from "@/lib/server/api-variants";
import type { CapabilityHandler } from "@/lib/server/capabilities";
import type { Model } from "@/lib/server/db/schema";
import { resetDb, seedUser } from "@/tests/helpers/db";
import { jsonResponse } from "./helpers";

function fakeVariant(parseResponse: (json: unknown) => NormalizedNonStreamResult): UpstreamApiVariant {
    return {
        id: "chat.completions",
        capability: "chat",
        path: "/chat/completions",
        supportsStreaming: false,
        parseResponse: (json) => parseResponse(json),
        parseStreamChunk(): never {
            throw new Error("parseStreamChunk not exercised by the non-stream suite");
        },
    };
}

function fakeCtx(capabilityId = "chat"): VariantContext {
    return {
        provider: {} as VariantContext["provider"],
        model: { upstreamModelId: "gpt-4o-mini" } as unknown as Model,
        meta: null,
        capability: { id: capabilityId } as CapabilityHandler,
        stream: false,
    };
}

function getLogRow(id: string) {
    const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, id)).get();
    if (!row) throw new Error(`log row ${id} not found`);
    return row;
}

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

describe("handleNonStream / JSON branch", () => {
    beforeEach(() => resetDb());

    it("parses a normal JSON completion, logs it as completed, and forwards onComplete", async () => {
        const logId = freshLogId();
        const upstream = jsonResponse({ id: "chatcmpl-1", choices: [{ message: { content: "hi" } }] });
        const variant = fakeVariant(() => ({
            output: "hi",
            promptTokens: 3,
            completionTokens: 2,
            totalTokens: 5,
            normalized: { id: "chatcmpl-1", usage: { total_tokens: 5 } },
        }));

        let completeInfo: unknown;
        const { response, logId: returnedLogId } = await handleNonStream({
            upstream,
            variant,
            ctx: fakeCtx(),
            opts: { onComplete: (info) => (completeInfo = info) },
            started: Date.now(),
            logId,
        });

        expect(returnedLogId).toBe(logId);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        await expect(response.json()).resolves.toEqual({ id: "chatcmpl-1", usage: { total_tokens: 5 } });

        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        expect(row.output).toBe("hi");
        expect(row.promptTokens).toBe(3);
        expect(row.completionTokens).toBe(2);
        expect(row.totalTokens).toBe(5);
        expect(row.reason).toBeNull();
        expect(row.generation).toEqual({ id: "chatcmpl-1", usage: { total_tokens: 5 } });

        expect(completeInfo).toMatchObject({
            content: "hi",
            reasoning: "",
            usage: { total_tokens: 5 },
        });
    });

    it("falls back to an empty string on onComplete.content when parsed.output is explicitly null", async () => {
        const logId = freshLogId();
        const upstream = jsonResponse({ id: "chatcmpl-null-output" });
        const variant = fakeVariant(() => ({
            output: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: { id: "chatcmpl-null-output" },
        }));

        let completeInfo: unknown;
        await handleNonStream({
            upstream,
            variant,
            ctx: fakeCtx(),
            opts: { onComplete: (info) => (completeInfo = info) },
            started: Date.now(),
            logId,
        });

        expect(getLogRow(logId).output).toBeNull(); // the LOG keeps the raw null…
        expect(completeInfo).toMatchObject({ content: "" }); // …but the live callback gets "" (?? fallback)
    });

    it("treats a legitimate empty body as {} rather than failing", async () => {
        const logId = freshLogId();
        const upstream = new Response("", { status: 200, headers: { "Content-Type": "application/json" } });
        let sawJson: unknown;
        const variant = fakeVariant((json) => {
            sawJson = json;
            return { output: null, promptTokens: null, completionTokens: null, totalTokens: null, normalized: {} };
        });

        const { response } = await handleNonStream({ upstream, variant, ctx: fakeCtx(), opts: {}, started: Date.now(), logId });

        expect(sawJson).toEqual({});
        await expect(response.json()).resolves.toEqual({});
        expect(getLogRow(logId).status).toBe("completed");
    });

    it("fails the log with 502 when the upstream body is not valid JSON", async () => {
        const logId = freshLogId();
        const upstream = new Response("not json{{{", { status: 200, headers: { "Content-Type": "application/json" } });
        const variant = fakeVariant(() => {
            throw new Error("parseResponse should never be reached");
        });

        await expect(
            handleNonStream({ upstream, variant, ctx: fakeCtx(), opts: {}, started: Date.now(), logId }),
        ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Upstream returned invalid JSON") });

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toContain("Upstream returned invalid JSON");
        expect(row.output).toBe("not json{{{");
    });

    it("fails the log with 502 when reading the upstream body text throws (abort/truncation mid-body)", async () => {
        const logId = freshLogId();
        const upstream = {
            headers: new Headers({ "Content-Type": "application/json" }),
            text: () => Promise.reject(new Error("aborted")),
        } as unknown as Response;
        const variant = fakeVariant(() => {
            throw new Error("parseResponse should never be reached");
        });

        await expect(
            handleNonStream({ upstream, variant, ctx: fakeCtx(), opts: {}, started: Date.now(), logId }),
        ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Upstream body read failed: aborted") });

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("Upstream body read failed: aborted");
    });

    it("stringifies a non-Error rejection value when reading the upstream body text throws", async () => {
        const logId = freshLogId();
        const upstream = {
            headers: new Headers({ "Content-Type": "application/json" }),
             
            text: () => Promise.reject("connection-reset-string"),
        } as unknown as Response;
        const variant = fakeVariant(() => {
            throw new Error("parseResponse should never be reached");
        });

        await expect(
            handleNonStream({ upstream, variant, ctx: fakeCtx(), opts: {}, started: Date.now(), logId }),
        ).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("Upstream body read failed: connection-reset-string"),
        });
        expect(getLogRow(logId).reason).toBe("Upstream body read failed: connection-reset-string");
    });

    it("promotes a variant-reported terminal error (HTTP 200 body) to a failed log + onComplete.error", async () => {
        const logId = freshLogId();
        const upstream = jsonResponse({ status: "failed", error: { message: "content filter" } });
        const variant = fakeVariant(() => ({
            output: "",
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            normalized: { status: "failed" },
            error: "content filter",
        }));

        let completeInfo: unknown;
        await handleNonStream({
            upstream,
            variant,
            ctx: fakeCtx(),
            opts: { onComplete: (info) => (completeInfo = info) },
            started: Date.now(),
            logId,
        });

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("content filter");
        expect(completeInfo).toMatchObject({ error: "content filter" });
    });

    it("persists image b64_json artifacts to the log copy while forwarding the untouched payload to the caller", async () => {
        const logId = freshLogId();
        const b64 = Buffer.from("fake-png-bytes").toString("base64");
        const upstream = jsonResponse({ created: 1, data: [{ b64_json: b64 }] });
        const variant = fakeVariant(() => ({
            output: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: { created: 1, data: [{ b64_json: b64 }] },
        }));

        const { response } = await handleNonStream({ upstream, variant, ctx: fakeCtx("image"), opts: {}, started: Date.now(), logId });

        // Caller-facing response: untouched, b64_json intact.
        const callerJson = (await response.json()) as { data: Array<{ b64_json: string }> };
        expect(callerJson.data[0].b64_json).toBe(b64);

        // Log copy: b64 stripped, replaced by a same-origin artifact URL.
        const row = getLogRow(logId);
        const generation = row.generation as { data: Array<Record<string, unknown>>; loom_artifacts: unknown[] };
        expect(generation.data[0].b64_json).toBeUndefined();
        expect(generation.data[0].url).toBe(`/api/logs/generations/${logId}/images/0`);
        expect(generation.data[0].loom_artifact).toBe(true);
        expect(generation.loom_artifacts).toHaveLength(1);
    });

    it("falls back to the untouched normalized log copy when persistImageArtifacts throws", async () => {
        const logId = freshLogId();
        // A function value anywhere inside the object makes structuredClone
        // throw a DataCloneError — forces the catch branch deterministically
        // without needing to mock the fs module.
        const unclonable = () => {};
        const upstream = jsonResponse({ ok: true });
        const variant = fakeVariant(() => ({
            output: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: { data: [{ b64_json: "x" }], poison: unclonable } as unknown as Record<string, unknown>,
        }));

        const { response } = await handleNonStream({ upstream, variant, ctx: fakeCtx("image"), opts: {}, started: Date.now(), logId });

        // Caller response still carries the original (unclonable-safe since
        // JSON.stringify simply drops function-valued keys, not throws).
        await expect(response.json()).resolves.toEqual({ data: [{ b64_json: "x" }] });

        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        const generation = row.generation as { data: Array<Record<string, unknown>> };
        // Falls back to the (unmodified) normalized payload — b64_json survives
        // in the log copy because persistImageArtifacts's write never ran.
        expect(generation.data[0].b64_json).toBe("x");
    });

    it("does not attempt artifact persistence for non-image capabilities", async () => {
        const logId = freshLogId();
        const upstream = jsonResponse({ ok: true });
        const variant = fakeVariant(() => ({
            output: "hi",
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: { data: [{ b64_json: "should-stay-untouched" }] },
        }));

        await handleNonStream({ upstream, variant, ctx: fakeCtx("chat"), opts: {}, started: Date.now(), logId });

        const row = getLogRow(logId);
        const generation = row.generation as { data: Array<Record<string, unknown>> };
        expect(generation.data[0].b64_json).toBe("should-stay-untouched");
    });
});

describe("handleNonStream / binary or unknown content-type branch", () => {
    beforeEach(() => resetDb());

    it("passes binary bodies through with the original content-type and logs the byte size", async () => {
        const logId = freshLogId();
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        const upstream = new Response(bytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
        const variant = fakeVariant(() => {
            throw new Error("parseResponse should never run for a binary response");
        });

        const { response } = await handleNonStream({ upstream, variant, ctx: fakeCtx("audio.speech"), opts: {}, started: Date.now(), logId });

        expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
        const buf = new Uint8Array(await response.arrayBuffer());
        expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);

        const row = getLogRow(logId);
        expect(row.status).toBe("completed");
        expect(row.output).toBe("binary response (audio/mpeg, 5 bytes)");
    });

    it("defaults to application/octet-stream when the upstream sends no content-type", async () => {
        const logId = freshLogId();
        const upstream = new Response(new Uint8Array([9]), { status: 200 });
        const variant = fakeVariant(() => {
            throw new Error("unused");
        });

        const { response } = await handleNonStream({ upstream, variant, ctx: fakeCtx("audio.speech"), opts: {}, started: Date.now(), logId });
        expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(getLogRow(logId).output).toBe("binary response (unknown, 1 bytes)");
    });

    it("fails the log with 502 when reading the binary body throws mid-transfer", async () => {
        const logId = freshLogId();
        const upstream = {
            headers: new Headers({ "Content-Type": "audio/mpeg" }),
            arrayBuffer: () => Promise.reject(new Error("socket reset")),
        } as unknown as Response;
        const variant = fakeVariant(() => {
            throw new Error("unused");
        });

        await expect(
            handleNonStream({ upstream, variant, ctx: fakeCtx("audio.speech"), opts: {}, started: Date.now(), logId }),
        ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Upstream binary body read failed: socket reset") });

        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("Upstream binary body read failed: socket reset");
    });

    it("stringifies a non-Error rejection value when reading the binary body throws", async () => {
        const logId = freshLogId();
        const upstream = {
            headers: new Headers({ "Content-Type": "audio/mpeg" }),
             
            arrayBuffer: () => Promise.reject("disk-full-string"),
        } as unknown as Response;
        const variant = fakeVariant(() => {
            throw new Error("unused");
        });

        await expect(
            handleNonStream({ upstream, variant, ctx: fakeCtx("audio.speech"), opts: {}, started: Date.now(), logId }),
        ).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("Upstream binary body read failed: disk-full-string"),
        });
        expect(getLogRow(logId).reason).toBe("Upstream binary body read failed: disk-full-string");
    });
});
