// Retry / backoff / abort-timeout tests for `forwardGeneration`'s upstream
// fetch loop (lib/server/gateway/index.ts). Split out from
// forward-generation.test.ts so `vi.useFakeTimers()` stays scoped to the
// tests that actually need it.
//
// Retry contract exercised here (see lib/server/gateway/index.ts fetch loop):
//   - model.maxRetries = EXTRA attempts after the initial one.
//   - Retriable: network reject (fetch throws) OR upstream 5xx OR 429.
//   - NOT retriable: non-429 4xx, or any failure where `combinedSignal.aborted`
//     is true, or a rejection named AbortError/TimeoutError.
//   - Backoff: `Math.min(5000, 250 * 2 ** (attempt - 1))` real setTimeout,
//     so `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` lets us assert
//     the exact delay without ever actually waiting.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { forwardGeneration } from "@/lib/server/gateway";
import { registerAdapter, type ProviderAdapter } from "@/lib/server/adapters";
import type { AdapterId, NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { SessionUser } from "@/lib/server/auth";
import type { GenerationLog, Provider, User } from "@/lib/server/db/schema";
import { resetDb, seedModel, seedProvider, seedUser } from "@/tests/helpers/db";
import { jsonResponse, mockFetch } from "./helpers";

function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function getLogRow(id: string): GenerationLog {
    const row = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, id)).get();
    if (!row) throw new Error(`log row ${id} not found`);
    return row;
}

const TEST_ADAPTER_ID = "test-fg-retry-adapter" as AdapterId;
const testAdapter: ProviderAdapter = {
    id: TEST_ADAPTER_ID,
    label: "Test forward-generation retry adapter",
    matches: () => false,
    fetchModels: async () => [],
    extractModelMeta: (raw) => raw as NormalizedModelMeta,
    upstreamUrl: (args) => `${args.provider.baseUrl.replace(/\/$/, "")}${args.variant.path}`,
    upstreamHeaders: () => ({ "Content-Type": "application/json" }),
};
registerAdapter(testAdapter);

function seedChatModel(overrides: Partial<Provider> = {}, maxRetries = 2) {
    const provider = seedProvider({ adapterId: TEST_ADAPTER_ID, ...overrides });
    const model = seedModel({
        providerId: provider.id,
        name: "retry-model",
        upstreamModelId: "gpt-4o-mini",
        type: "chat",
        maxRetries,
    });
    return { provider, model };
}

const CHAT_BODY = (modelName: string) => ({ model: modelName, messages: [{ role: "user", content: "hi" }] });

beforeEach(() => resetDb());
afterEach(() => {
    vi.useRealTimers();
});

describe("forwardGeneration / retry on transient failures", () => {
    it("retries a 500 once (waiting exactly the 250ms backoff floor) and succeeds on the second attempt", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock
            .mockResolvedValueOnce(new Response("server error", { status: 500 }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));

        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1); // first attempt made, now backing off

        await vi.advanceTimersByTimeAsync(249);
        expect(fetchMock).toHaveBeenCalledTimes(1); // still within the 250ms floor

        await vi.advanceTimersByTimeAsync(1);
        const { response, logId } = await promise;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await expect(response.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
        expect(getLogRow(logId).status).toBe("completed");
    });

    it("retries a 429 and succeeds on the second attempt", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock
            .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        await vi.advanceTimersByTimeAsync(300);
        const { response } = await promise;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await expect(response.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    });

    it("retries a rejected fetch (network error) and succeeds on the second attempt", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock
            .mockRejectedValueOnce(new Error("ECONNRESET"))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        await vi.advanceTimersByTimeAsync(300);
        const { response } = await promise;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await expect(response.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    });

    it("doubles the backoff on the second retry (250ms then 500ms), capped observations via advanceTimersByTimeAsync", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel({}, 2); // maxRetries=2 -> up to 3 attempts
        const fetchMock = mockFetch();
        fetchMock
            .mockResolvedValueOnce(new Response("e1", { status: 500 }))
            .mockResolvedValueOnce(new Response("e2", { status: 500 }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));

        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(250); // first backoff (250ms) elapses
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(499);
        expect(fetchMock).toHaveBeenCalledTimes(2); // second backoff (500ms) not yet elapsed
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const { response } = await promise;
        await expect(response.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    });

    it("drains the failed response body (calls .cancel()) before retrying so the connection is freed", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel();
        let cancelled = false;
        const failingBody = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("err"));
                controller.close();
            },
            cancel() {
                cancelled = true;
            },
        });
        const fetchMock = mockFetch();
        fetchMock
            .mockResolvedValueOnce(new Response(failingBody, { status: 503 }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        await vi.advanceTimersByTimeAsync(300);
        await promise;
        expect(cancelled).toBe(true);
    });

    it("swallows a body.cancel() rejection instead of letting it break the retry", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel();
        const failingBody = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("err"));
                controller.close();
            },
            cancel() {
                throw new Error("cancel exploded");
            },
        });
        const fetchMock = mockFetch();
        fetchMock
            .mockResolvedValueOnce(new Response(failingBody, { status: 503 }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        await vi.advanceTimersByTimeAsync(300);
        const { response } = await promise;
        await expect(response.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    });

    it("handles a null response body on a retriable failure without throwing (optional-chaining drain)", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock
            .mockResolvedValueOnce(new Response(null, { status: 500 }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        await vi.advanceTimersByTimeAsync(300);
        const { response } = await promise;
        await expect(response.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    });
});

describe("forwardGeneration / retry exhaustion", () => {
    it("passes through the final 5xx response (no throw) once retries are exhausted", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel({}, 2); // 1 initial + 2 retries = 3 total attempts
        const fetchMock = mockFetch();
        // A fresh Response (and fresh body stream) per call — reusing one
        // instance would mean the body drained on retry 1/2 (to free the
        // connection) leaves nothing to read on the final passthrough.
        fetchMock.mockImplementation(async () => new Response("still down", { status: 500 }));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        await vi.advanceTimersByTimeAsync(10_000);
        const { response, logId } = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(response.status).toBe(500);
        await expect(response.text()).resolves.toBe("still down");
        const row = getLogRow(logId);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe("Upstream HTTP 500");
    });

    it("throws a 502 once network-error retries are exhausted", async () => {
        vi.useFakeTimers();
        const user = seedUser();
        const { model } = seedChatModel({}, 2);
        const fetchMock = mockFetch();
        fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        // Attach the rejection assertion before advancing timers so the
        // handler is registered synchronously (avoids a benign but noisy
        // "handled asynchronously" unhandled-rejection warning).
        const assertion = expect(promise).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("ECONNREFUSED"),
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("makes exactly one attempt when model.maxRetries is 0", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, 0);
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response("down", { status: 500 }));

        const { response } = await forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(500);
    });

    it("stringifies a non-Error rejection value once retries are exhausted (maxRetries: 0)", async () => {
        const user = seedUser();
        const { model } = seedChatModel({}, 0);
        const fetchMock = mockFetch();
         
        fetchMock.mockRejectedValue("plain-string-rejection");

        await expect(
            forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name)),
        ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("plain-string-rejection") });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("forwardGeneration / no retry on non-retriable outcomes", () => {
    it("does not retry a plain 400 (single attempt, immediate passthrough)", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));

        const { response } = await forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(400);
    });

    it("does not retry a plain 404", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

        const { response } = await forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(404);
    });

    it("does not retry when combinedSignal is already aborted, even for an otherwise-retriable-looking error", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        fetchMock.mockRejectedValue(new Error("generic network noise"));

        const controller = new AbortController();
        controller.abort("client gone");

        await expect(
            forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name), { signal: controller.signal }),
        ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("generic network noise") });
        expect(fetchMock).toHaveBeenCalledTimes(1); // no retry despite maxRetries=2
    });

    it("does not retry a rejection named AbortError even with retries remaining", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        fetchMock.mockRejectedValue(abortErr);

        await expect(
            forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name)),
        ).rejects.toMatchObject({ status: 502 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry a rejection named TimeoutError even with retries remaining", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        const timeoutErr = new Error("The operation timed out");
        timeoutErr.name = "TimeoutError";
        fetchMock.mockRejectedValue(timeoutErr);

        await expect(
            forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name)),
        ).rejects.toMatchObject({ status: 502 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("fails the log with the abort reason when the caller disconnects before the upstream ever resolves", async () => {
        const user = seedUser();
        const { model } = seedChatModel();
        const fetchMock = mockFetch();
        // Resolve `invoked` synchronously inside the mock so the test can
        // wait for the exact microtask where the pipeline reaches `fetch()`
        // before aborting — otherwise `controller.abort()` (called right
        // after `forwardGeneration(...)`) can fire before the in-flight
        // async pipeline has even registered the upstream call, since
        // `forwardGeneration` yields at several `await`s (resolveModel,
        // etc.) before reaching this point.
        let markInvoked: () => void;
        const invoked = new Promise<void>((resolve) => {
            markInvoked = resolve;
        });
        fetchMock.mockImplementation((_url: string, init: RequestInit) => {
            markInvoked();
            const signal = init.signal as AbortSignal;
            return new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => {
                    const err = new Error("This operation was aborted");
                    err.name = "AbortError";
                    reject(err);
                });
            });
        });

        const controller = new AbortController();
        const promise = forwardGeneration(toSessionUser(user), "chat", CHAT_BODY(model.name), { signal: controller.signal });
        await invoked;
        controller.abort("client disconnected mid-flight");

        await expect(promise).rejects.toMatchObject({ status: 502 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
