import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/server/capabilities/register";
import "@/lib/server/api-variants/register";
import { getCapability } from "@/lib/server/capabilities";
import { getVariant } from "@/lib/server/api-variants";
import {
    applyFieldFilter,
    bearerAuthHeaders,
    bearerResourceHeaders,
    defaultResourceUrl,
    defaultUpstreamUrl,
    fetchOpenAIModels,
    openaiAdapter,
} from "@/lib/server/adapters/openai";
import type { ResourceCallArgs, UpstreamCallArgs } from "@/lib/server/adapters";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";
import { makeModel, makeProvider } from "./fixtures";

const capability = getCapability("chat")!;
const variant = getVariant("chat.completions")!;

function makeArgs(overrides: Partial<UpstreamCallArgs> = {}): UpstreamCallArgs {
    return {
        provider: makeProvider(),
        model: makeModel(),
        meta: null,
        capability,
        variant,
        stream: false,
        ...overrides,
    };
}

describe("adapters/openai — URL & header helpers", () => {
    it("defaultUpstreamUrl joins base_url + variant.path, trimming a trailing slash", () => {
        expect(defaultUpstreamUrl(makeArgs({ provider: makeProvider({ baseUrl: "https://api.example.com/v1/" }) })))
            .toBe("https://api.example.com/v1/chat/completions");
        expect(defaultUpstreamUrl(makeArgs({ provider: makeProvider({ baseUrl: "https://api.example.com/v1" }) })))
            .toBe("https://api.example.com/v1/chat/completions");
    });

    it("bearerAuthHeaders sets Authorization only when an apiKey is present", () => {
        const withKey = bearerAuthHeaders(makeArgs(), "sk-abc123");
        expect(withKey).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk-abc123" });

        const withoutKey = bearerAuthHeaders(makeArgs(), null);
        expect(withoutKey).toEqual({ "Content-Type": "application/json" });
        expect("Authorization" in withoutKey).toBe(false);
    });

    it("defaultResourceUrl appends the query string only when provided", () => {
        const args: ResourceCallArgs = { provider: makeProvider({ baseUrl: "https://api.example.com/v1/" }), model: makeModel(), path: "/videos/abc" };
        expect(defaultResourceUrl(args)).toBe("https://api.example.com/v1/videos/abc");
        expect(defaultResourceUrl({ ...args, query: "foo=bar" })).toBe("https://api.example.com/v1/videos/abc?foo=bar");
    });

    it("bearerResourceHeaders only sets Authorization, never Content-Type", () => {
        const args: ResourceCallArgs = { provider: makeProvider(), model: makeModel(), path: "/x" };
        expect(bearerResourceHeaders(args, "sk-abc")).toEqual({ Authorization: "Bearer sk-abc" });
        expect(bearerResourceHeaders(args, null)).toEqual({});
    });
});

describe("adapters/openai — applyFieldFilter", () => {
    it("returns the same body reference when meta is null", () => {
        const body = { model: "gpt-4o", temperature: 0.5 };
        expect(applyFieldFilter(body, null)).toBe(body);
    });

    it("returns the same body reference when accepted_fields and rejected_fields are both empty", () => {
        const body = { model: "gpt-4o", temperature: 0.5 };
        const meta: NormalizedModelMeta = { upstream_id: "x", supported_apis: [], capabilities: {}, accepted_fields: [], rejected_fields: [] };
        expect(applyFieldFilter(body, meta)).toBe(body);
    });

    it("keeps only accepted fields, but ALWAYS_ON fields bypass the accept-list", () => {
        const body = { model: "gpt-4o", messages: [], stream: true, input: "x", prompt: "y", temperature: 0.5, top_p: 0.9 };
        const meta: NormalizedModelMeta = { upstream_id: "x", supported_apis: [], capabilities: {}, accepted_fields: ["temperature"] };
        const out = applyFieldFilter(body, meta);
        expect(out).toEqual({ model: "gpt-4o", messages: [], stream: true, input: "x", prompt: "y", temperature: 0.5 });
        expect(out).not.toHaveProperty("top_p");
    });

    it("drops rejected fields, but ALWAYS_ON fields bypass the reject-list (checked before reject)", () => {
        const body = { model: "gpt-4o", frequency_penalty: 1, custom_field: "keep-me" };
        const meta: NormalizedModelMeta = { upstream_id: "x", supported_apis: [], capabilities: {}, rejected_fields: ["model", "frequency_penalty"] };
        const out = applyFieldFilter(body, meta);
        // "model" survives despite being in rejected_fields — ALWAYS_ON wins.
        expect(out).toEqual({ model: "gpt-4o", custom_field: "keep-me" });
    });

    it("rejected_fields takes priority over accepted_fields for the same key", () => {
        const body = { model: "gpt-4o", temperature: 0.5 };
        const meta: NormalizedModelMeta = {
            upstream_id: "x",
            supported_apis: [],
            capabilities: {},
            accepted_fields: ["temperature"],
            rejected_fields: ["temperature"],
        };
        const out = applyFieldFilter(body, meta);
        expect(out).toEqual({ model: "gpt-4o" });
    });
});

describe("adapters/openai — extractModelMeta", () => {
    it("classifies a chat model id and defaults capability flags", () => {
        const meta = openaiAdapter.extractModelMeta({ id: "gpt-4o-mini", owned_by: "openai" }, makeProvider());
        expect(meta).toEqual({
            upstream_id: "gpt-4o-mini",
            label: "gpt-4o-mini",
            supported_apis: ["chat.completions"],
            capabilities: { chat: true, embeddings: false, audio_in: false, audio_out: false },
            owned_by: "openai",
            raw: { id: "gpt-4o-mini", owned_by: "openai" },
        });
    });

    it.each([
        ["text-embedding-3-small", "embeddings", { chat: false, embeddings: true, audio_in: false, audio_out: false }],
        ["dall-e-3", "images.generations", { chat: false, embeddings: false, audio_in: false, audio_out: false }],
        ["tts-1", "audio.speech", { chat: false, embeddings: false, audio_in: false, audio_out: true }],
        ["whisper-1", "audio.transcriptions", { chat: false, embeddings: false, audio_in: true, audio_out: false }],
        ["bge-reranker-large", "rerank", { chat: false, embeddings: false, audio_in: false, audio_out: false }],
        ["sora-2", "videos", { chat: false, embeddings: false, audio_in: false, audio_out: false }],
    ] as const)("classifies %s as supported_apis=[%s]", (id, api, caps) => {
        const meta = openaiAdapter.extractModelMeta({ id }, makeProvider())!;
        expect(meta.supported_apis).toEqual([api]);
        expect(meta.capabilities).toEqual(caps);
        expect(meta.owned_by).toBeNull();
    });

    it("returns null when the raw entry has no string id", () => {
        expect(openaiAdapter.extractModelMeta({}, makeProvider())).toBeNull();
        expect(openaiAdapter.extractModelMeta({ id: 123 }, makeProvider())).toBeNull();
        expect(openaiAdapter.extractModelMeta(null, makeProvider())).toBeNull();
    });
});

describe("adapters/openai — openaiAdapter object", () => {
    it("has the expected id/label and a catch-all matches()", () => {
        expect(openaiAdapter.id).toBe("openai");
        expect(openaiAdapter.label).toBeTruthy();
        expect(openaiAdapter.matches(makeProvider({ baseUrl: "https://anything.example.com" }))).toBe(true);
        expect(openaiAdapter.matches(makeProvider({ baseUrl: "not a url at all" }))).toBe(true);
    });

    it("delegates upstreamUrl/upstreamHeaders/resourceUrl/resourceHeaders to the shared helpers", () => {
        const args = makeArgs();
        expect(openaiAdapter.upstreamUrl(args)).toBe(defaultUpstreamUrl(args));
        expect(openaiAdapter.upstreamHeaders(args, "sk-x")).toEqual(bearerAuthHeaders(args, "sk-x"));
        const rArgs: ResourceCallArgs = { provider: args.provider, model: args.model, path: "/videos/1" };
        expect(openaiAdapter.resourceUrl!(rArgs)).toBe(defaultResourceUrl(rArgs));
        expect(openaiAdapter.resourceHeaders!(rArgs, "sk-x")).toEqual(bearerResourceHeaders(rArgs, "sk-x"));
    });

    it("finalizeRequest stamps the upstream model id, overwriting any existing model field", () => {
        const args = makeArgs({ model: makeModel({ upstreamModelId: "gpt-4o-2024-08-06" }) });
        const out = openaiAdapter.finalizeRequest!({ model: "display-name", temperature: 0.2 }, args);
        expect(out).toEqual({ model: "gpt-4o-2024-08-06", temperature: 0.2 });
    });

    it("fetchModels is the shared fetchOpenAIModels implementation", () => {
        expect(openaiAdapter.fetchModels).toBe(fetchOpenAIModels);
    });
});

describe("adapters/openai — fetchOpenAIModels", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    it("returns json.data when the response wraps an array", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ id: "a" }, { id: "b" }] }),
        });
        const models = await fetchOpenAIModels(makeProvider({ baseUrl: "https://api.example.com/v1/" }), "sk-key");
        expect(models).toEqual([{ id: "a" }, { id: "b" }]);
        const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe("https://api.example.com/v1/models");
        expect(options.headers).toEqual({ Accept: "application/json", Authorization: "Bearer sk-key" });
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it("returns the bare array when the response root is already an array", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [{ id: "c" }] });
        const models = await fetchOpenAIModels(makeProvider(), null);
        expect(models).toEqual([{ id: "c" }]);
    });

    it("returns [] when the response has neither an array root nor a data array", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
        const models = await fetchOpenAIModels(makeProvider(), null);
        expect(models).toEqual([]);
    });

    it("omits the Authorization header when apiKey is null", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
        await fetchOpenAIModels(makeProvider(), null);
        const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(options.headers).toEqual({ Accept: "application/json" });
    });

    it("throws with the HTTP status and URL when the response is not ok", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503 });
        await expect(fetchOpenAIModels(makeProvider({ baseUrl: "https://api.example.com/v1" }), null))
            .rejects.toThrow(/models discovery HTTP 503 from https:\/\/api\.example\.com\/v1\/models/);
    });
});
