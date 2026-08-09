// Shared test-only helpers for the gateway suite. Not a *.test.ts file so
// vitest's `tests/node/**/*.test.ts` include glob never picks it up as its
// own suite — it's just a module the sibling test files import from.

import { vi } from "vitest";

/** Turn a list of raw text pieces into a byte-chunked ReadableStream, one
 *  `enqueue()` per array entry. Callers control chunk boundaries directly
 *  so tests can exercise both "one SSE event per network chunk" and
 *  "an SSE line split across two chunks" framing. */
export function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (i >= chunks.length) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(chunks[i]));
            i++;
        },
    });
}

/** Build a ReadableStream that emits the given chunks and then errors
 *  instead of closing — simulates an upstream connection dropping
 *  mid-stream (network reset, proxy timeout, etc.). */
export function erroringStream(chunks: string[], err: Error): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (i >= chunks.length) {
                controller.error(err);
                return;
            }
            controller.enqueue(encoder.encode(chunks[i]));
            i++;
        },
    });
}

/** Format a list of SSE event payloads (already-parsed objects, or the
 *  literal string "[DONE]") into `data: ...\n\n` wire chunks, one chunk
 *  per event — the common case for our fake upstreams. */
export function sseChunks(events: Array<unknown | "[DONE]">): string[] {
    return events.map((e) => `data: ${e === "[DONE]" ? "[DONE]" : JSON.stringify(e)}\n\n`);
}

/** A ReadableStream built straight from SSE event payloads, terminated
 *  with [DONE] unless the caller already included one. */
export function sseStream(events: Array<unknown | "[DONE]">): ReadableStream<Uint8Array> {
    const withDone = events.some((e) => e === "[DONE]") ? events : [...events, "[DONE]" as const];
    return chunkedStream(sseChunks(withDone));
}

/** Drain a ReadableStream<Uint8Array> to a single decoded string — mirrors
 *  what `Response.text()` does, but usable on bare streams returned by
 *  `handleStream` helpers under test without wrapping in a Response. */
export async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
}

/** Parse a chat-completion-shaped SSE text blob (as emitted by
 *  `handleStream`) into the ordered list of decoded JSON chunk payloads,
 *  dropping the terminal `[DONE]` sentinel. */
export function parseSseEvents(text: string): Record<string, unknown>[] {
    return text
        .split("\n\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((data) => data && data !== "[DONE]")
        .map((data) => JSON.parse(data));
}

/** Build a `Response` whose JSON body is the given value. Mirrors what a
 *  real upstream would send back for a non-streaming chat/embedding/etc.
 *  call. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
}

/** Build a streaming `Response` whose body emits the given SSE events. */
export function sseResponse(events: Array<unknown | "[DONE]">, init: ResponseInit = {}): Response {
    return new Response(sseStream(events), {
        status: 200,
        ...init,
        headers: { "Content-Type": "text/event-stream", ...(init.headers ?? {}) },
    });
}

/** Install a `vi.fn()` on `global.fetch` and return it for assertions.
 *  Callers set `.mockImplementation` / `.mockResolvedValueOnce` etc. */
export function mockFetch(): ReturnType<typeof vi.fn> {
    const fn = vi.fn();
    // Cast through unknown: the real DOM lib type for fetch is stricter
    // than a bare vi.fn() mock's inferred type, and we only ever call it
    // the way our own gateway code does (url, init).
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}
