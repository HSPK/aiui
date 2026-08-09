import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { gateway } from "@/lib/api/gateway";
import { errJson, installFetchMock, okJson, sseResponse } from "./test-helpers";

describe("lib/api/gateway", () => {
    describe("playgroundChat", () => {
        it("POSTs the chat body to /playground/chat and returns the raw streaming Response untouched", async () => {
            const fetchMock = installFetchMock();
            const raw = sseResponse(["data: {\"delta\":\"hi\"}\n\n"], {
                "X-Conversation-ID": "conv-1",
                "X-Message-ID": "msg-1",
                "X-Generation-ID": "gen-1",
            });
            fetchMock.mockResolvedValueOnce(raw);

            const res = await gateway.playgroundChat({ message: "hi", model: "gpt-4" });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/playground/chat");
            expect(init.method).toBe("POST");
            expect(init.body).toBe(JSON.stringify({ message: "hi", model: "gpt-4" }));
            // rawFetch does not unwrap the envelope — the exact same Response
            // (headers + a live ReadableStream body) must come back so the
            // stream-client can read SSE chunks off it.
            expect(res).toBe(raw);
            expect(res.headers.get("X-Conversation-ID")).toBe("conv-1");
            expect(res.body).not.toBeNull();

            const reader = res.body!.getReader();
            const { value } = await reader.read();
            expect(new TextDecoder().decode(value)).toBe("data: {\"delta\":\"hi\"}\n\n");
        });
    });

    describe("playgroundEmbedding", () => {
        it("POSTs to /playground/embedding and unwraps the envelope", async () => {
            const fetchMock = installFetchMock();
            const mockResult = {
                query: "hello",
                documents: ["world"],
                results: [
                    {
                        model: "text-embedding-3-small",
                        query_vector: [0.1, 0.2],
                        document_vectors: [[0.3, 0.4]],
                        dim: 2,
                        scores: [{ index: 0, score: 0.9 }],
                        prompt_tokens: 10,
                        total_tokens: 12,
                        elapsed_ms: 42,
                    },
                ],
            };
            fetchMock.mockResolvedValueOnce(okJson(mockResult));
            const result = await gateway.playgroundEmbedding({
                models: ["text-embedding-3-small"],
                query: "hello",
                documents: ["world"],
            });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/playground/embedding");
            expect(init.method).toBe("POST");
            expect(result).toEqual(mockResult);
        });
    });

    describe("generateTitle", () => {
        it("extracts, unquotes, and truncates the model's title to 50 chars", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ choices: [{ message: { content: `"${"A".repeat(60)}"` } }] }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                )
            );
            const title = await gateway.generateTitle({ model: "gpt-4", user: "hi", assistant: "hello" });
            expect(title).toBe("A".repeat(50));
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/v1/chat/completions");
            const sentBody = JSON.parse(init.body as string);
            expect(sentBody.model).toBe("gpt-4");
            expect(sentBody.stream).toBe(false);
            expect(sentBody.messages[1].content).toContain("User: hi");
            expect(sentBody.messages[1].content).toContain("Assistant: hello");
        });

        it("truncates the user/assistant excerpts embedded in the prompt to 500 chars each", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ choices: [{ message: { content: "Title" } }] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            );
            const longUser = "u".repeat(600);
            const longAssistant = "a".repeat(600);
            await gateway.generateTitle({ model: "gpt-4", user: longUser, assistant: longAssistant });
            const [, init] = fetchMock.mock.calls[0];
            const sentBody = JSON.parse(init.body as string);
            expect(sentBody.messages[1].content).toBe(`User: ${"u".repeat(500)}\n\nAssistant: ${"a".repeat(500)}`);
        });

        it("falls back to 'New Chat' when the model returns no choices", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ choices: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            );
            const title = await gateway.generateTitle({ model: "gpt-4", user: "hi", assistant: "hello" });
            expect(title).toBe("New Chat");
        });

        it("wraps a raw (non-ApiError) fetch failure into a generic ApiError", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockRejectedValueOnce(new TypeError("network down"));
            await expect(
                gateway.generateTitle({ model: "gpt-4", user: "hi", assistant: "hello" })
            ).rejects.toMatchObject({ message: "Failed to generate title", status: 500 });
        });

        it("rethrows an existing ApiError unwrapped (preserves the original message/status)", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(errJson(503, { msg: "upstream unavailable" }));
            await expect(
                gateway.generateTitle({ model: "gpt-4", user: "hi", assistant: "hello" })
            ).rejects.toMatchObject({ message: "upstream unavailable", status: 503 });
        });
    });

    describe("imageGenerate", () => {
        it("POSTs to /v1/images/generations and returns the parsed JSON", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ created: 1, data: [{ url: "https://x/1.png" }] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            );
            const result = await gateway.imageGenerate({ model: "gpt-image-1", prompt: "a cat" });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/v1/images/generations");
            expect(init.method).toBe("POST");
            expect(result).toEqual({ created: 1, data: [{ url: "https://x/1.png" }] });
        });
    });

    describe("speech", () => {
        it("POSTs to /v1/audio/speech and returns a Blob", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { "Content-Type": "audio/mpeg" },
                })
            );
            const blob = await gateway.speech({ model: "tts-1", input: "hi", voice: "alloy" });
            const [url] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/v1/audio/speech");
            // Response.blob() resolves via Node/undici's Blob, a different
            // realm/class than jsdom's global `Blob` — duck-type instead of
            // `toBeInstanceOf(Blob)`.
            expect(typeof blob.arrayBuffer).toBe("function");
            expect(blob.type).toBe("audio/mpeg");
            expect(blob.size).toBe(3);
        });
    });

    describe("transcribe", () => {
        it("builds FormData with only the required fields when optional args are omitted", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ text: "hello world" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            );
            const file = new File(["binarydata"], "audio.mp3", { type: "audio/mpeg" });
            const result = await gateway.transcribe({ model: "whisper-1", file });

            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/v1/audio/transcriptions");
            expect(init.method).toBe("POST");
            const fd = init.body as FormData;
            expect(fd).toBeInstanceOf(FormData);
            expect(fd.get("model")).toBe("whisper-1");
            expect(fd.get("file")).toBeInstanceOf(File);
            expect(fd.get("language")).toBeNull();
            expect(fd.get("prompt")).toBeNull();
            expect(fd.get("response_format")).toBeNull();
            expect(fd.get("temperature")).toBeNull();
            // FormData bodies must never get a forced Content-Type (breaks
            // multipart boundary detection) — confirmed at the client.ts
            // level already; spot-check it holds through this call site too.
            expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
            expect(result).toEqual({ text: "hello world" });
        });

        it("includes optional fields (language/prompt/response_format/temperature=0) when supplied", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ text: "bonjour" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            );
            const file = new File(["binarydata"], "audio.mp3", { type: "audio/mpeg" });
            await gateway.transcribe({
                model: "whisper-1",
                file,
                language: "fr",
                prompt: "greeting",
                response_format: "verbose_json",
                temperature: 0,
            });
            const [, init] = fetchMock.mock.calls[0];
            const fd = init.body as FormData;
            expect(fd.get("language")).toBe("fr");
            expect(fd.get("prompt")).toBe("greeting");
            expect(fd.get("response_format")).toBe("verbose_json");
            // `temperature != null` (not truthy) guards this append, so an
            // explicit 0 must still be included.
            expect(fd.get("temperature")).toBe("0");
        });

        it("returns plain text when the response Content-Type isn't JSON", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response("1\n00:00:00,000 --> 00:00:01,000\nHello\n", {
                    status: 200,
                    headers: { "Content-Type": "text/plain" },
                })
            );
            const file = new File(["binarydata"], "audio.mp3", { type: "audio/mpeg" });
            const result = await gateway.transcribe({ model: "whisper-1", file, response_format: "srt" });
            expect(result).toBe("1\n00:00:00,000 --> 00:00:01,000\nHello\n");
        });

        it("falls back to text when the response has no Content-Type header at all", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(new Response("plain body"));
            const file = new File(["binarydata"], "audio.mp3", { type: "audio/mpeg" });
            const result = await gateway.transcribe({ model: "whisper-1", file });
            expect(result).toBe("plain body");
        });

        it("treats a literal null Content-Type header the same as absent (nullish-coalescing fallback)", async () => {
            const fetchMock = installFetchMock();
            // A real `Response` always synthesizes a default Content-Type for
            // a string body, so `headers.get("Content-Type")` can never
            // actually return `null` through the real Fetch API in this
            // environment — fake the minimal Response surface rawFetch
            // consumes to exercise the `?? ""` fallback explicitly.
            fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async () => "raw fallback",
            } as unknown as Response);
            const file = new File(["binarydata"], "audio.mp3", { type: "audio/mpeg" });
            const result = await gateway.transcribe({ model: "whisper-1", file });
            expect(result).toBe("raw fallback");
        });
    });

    describe("video", () => {
        it("videoCreate() builds FormData and POSTs to /v1/videos", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: "v1", object: "video", status: "queued", model: "sora-2",
                        seconds: 4, size: "1280x720", progress: 0, created_at: 1,
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                )
            );
            const result = await gateway.videoCreate({ model: "sora-2", prompt: "a dog running" });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/v1/videos");
            expect(init.method).toBe("POST");
            const fd = init.body as FormData;
            expect(fd.get("model")).toBe("sora-2");
            expect(fd.get("prompt")).toBe("a dog running");
            expect(fd.get("seconds")).toBeNull();
            expect(fd.get("input_reference")).toBeNull();
            expect(result.id).toBe("v1");
        });

        it("videoCreate() includes seconds/size/input_reference when supplied", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: "v1", object: "video", status: "queued", model: "sora-2",
                        seconds: 8, size: "1280x720", progress: 0, created_at: 1,
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                )
            );
            const ref = new File(["imgdata"], "ref.png", { type: "image/png" });
            await gateway.videoCreate({ model: "sora-2", prompt: "a cat", seconds: 8, size: "1280x720", input_reference: ref });
            const [, init] = fetchMock.mock.calls[0];
            const fd = init.body as FormData;
            expect(fd.get("seconds")).toBe("8");
            expect(fd.get("size")).toBe("1280x720");
            expect(fd.get("input_reference")).toBeInstanceOf(File);
        });

        it("videoGet() GETs /v1/videos/<id>?model=<model>", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: "v1", object: "video", status: "completed", model: "sora-2",
                        seconds: 4, size: "1280x720", progress: 100, created_at: 1,
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                )
            );
            const result = await gateway.videoGet("v 1", "sora-2");
            expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/videos/v%201?model=sora-2");
            expect(result.status).toBe("completed");
        });

        it("videoDelete() DELETEs /v1/videos/<id>?model=<model>", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
            await gateway.videoDelete("v1", "sora-2");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/v1/videos/v1?model=sora-2");
            expect(init.method).toBe("DELETE");
        });

        it("videoContentUrl() builds a same-origin proxy URL with model+variant query params (default API_BASE = '/api')", () => {
            expect(gateway.videoContentUrl("v1", "sora-2")).toBe(
                "/api/v1/videos/v1/content?model=sora-2&variant=video"
            );
            expect(gateway.videoContentUrl("v1", "sora-2", "thumbnail")).toBe(
                "/api/v1/videos/v1/content?model=sora-2&variant=thumbnail"
            );
            expect(gateway.videoContentUrl("v 1", "sora-2", "spritesheet")).toBe(
                "/api/v1/videos/v%201/content?model=sora-2&variant=spritesheet"
            );
        });

        // Regression test (previously a bug at lib/api/gateway.ts:220):
        // videoContentUrl used to hardcode a "/api" prefix instead of
        // resolving against `API_BASE` from ./client, unlike every other
        // call in this module (all routed through fetcher/rawFetch, which
        // both resolve against API_BASE). That meant a deployment setting
        // NEXT_PUBLIC_API_URL (different origin or base path) got every
        // other gateway call adjusted automatically, but video content/
        // thumbnail/spritesheet URLs used in <video src> / <a download>
        // silently kept pointing at the wrong prefix (playback 404s).
        // `API_BASE` is a module-level const computed at import time, so
        // exercising a custom value requires stubbing the env *before* a
        // fresh import of the module.
        it("videoContentUrl() resolves against a custom NEXT_PUBLIC_API_URL (module-level API_BASE re-evaluated on fresh import)", async () => {
            vi.resetModules();
            vi.stubEnv("NEXT_PUBLIC_API_URL", "https://loom.example.com/api");
            try {
                const { gateway: freshGateway } = await import("@/lib/api/gateway");
                expect(freshGateway.videoContentUrl("v1", "sora-2")).toBe(
                    "https://loom.example.com/api/v1/videos/v1/content?model=sora-2&variant=video"
                );
                expect(freshGateway.videoContentUrl("v1", "sora-2", "thumbnail")).toBe(
                    "https://loom.example.com/api/v1/videos/v1/content?model=sora-2&variant=thumbnail"
                );
                // Also re-assert id-encoding and the third variant value
                // against the custom base, so the fix is verified under
                // both API_BASE branches, not just the default one.
                expect(freshGateway.videoContentUrl("v 1", "sora-2", "spritesheet")).toBe(
                    "https://loom.example.com/api/v1/videos/v%201/content?model=sora-2&variant=spritesheet"
                );
            } finally {
                vi.unstubAllEnvs();
                vi.resetModules();
            }
        });
    });
});
