// Shared test utilities for lib/api + lib/stores + lib/hooks + lib/themes
// coverage. NOT a test file itself (no `.test.` in the name) so vitest's
// `include: ["tests/dom/**/*.test.{ts,tsx}"]` glob skips it.
import { vi } from "vitest";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Standard `{code,msg,data}` envelope used by every internal endpoint. */
export function envelope<T>(data: T, code = 0, msg = "ok"): { code: number; msg: string; data: T } {
    return { code, msg, data };
}

/** A real `Response` wrapping a JSON envelope — closest to what `fetch` returns. */
export function okJson<T>(data: T, status = 200): Response {
    return new Response(JSON.stringify(envelope(data)), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/** A real `Response` with a non-2xx status and a JSON error body. */
export function errJson(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        statusText: "Error",
        headers: { "Content-Type": "application/json" },
    });
}

/** A non-2xx `Response` whose body is not valid JSON at all. */
export function errUnparseable(status: number, statusText = "Internal Server Error"): Response {
    return new Response("<html>not json</html>", { status, statusText });
}

/** Installs `global.fetch` as a fresh `vi.fn()` and returns it for assertions. */
export function installFetchMock(): ReturnType<typeof vi.fn> {
    const fn = vi.fn();
    global.fetch = fn;
    return fn;
}

/** Fresh QueryClient (retries disabled) + provider wrapper for `renderHook`. */
export function createQueryWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
        return React.createElement(QueryClientProvider, { client: queryClient }, children);
    }
    return { Wrapper, queryClient };
}

/** Builds a Response whose body streams the given string chunks (SSE-style). */
export function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
    return new Response(stream, { status: 200, headers });
}

/** Waits a macrotask so pending microtask chains (fetch mocks, effects) settle. */
export function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
