import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/server/capabilities/register";
import "@/lib/server/api-variants/register";
import { getCapability } from "@/lib/server/capabilities";
import { getVariant } from "@/lib/server/api-variants";
import { azureOpenAIAdapter } from "@/lib/server/adapters/azure-openai";
import type { ResourceCallArgs, UpstreamCallArgs } from "@/lib/server/adapters";
import { makeModel, makeProvider } from "./fixtures";

const capability = getCapability("chat")!;
const variant = getVariant("chat.completions")!;

function makeArgs(overrides: Partial<UpstreamCallArgs> = {}): UpstreamCallArgs {
    return {
        provider: makeProvider({ baseUrl: "https://my-res.openai.azure.com" }),
        model: makeModel({ upstreamModelId: "gpt-4o-deployment" }),
        meta: null,
        capability,
        variant,
        stream: false,
        ...overrides,
    };
}

describe("adapters/azure-openai — matches", () => {
    it("matches hosts ending in .openai.azure.com", () => {
        expect(azureOpenAIAdapter.matches(makeProvider({ baseUrl: "https://my-res.openai.azure.com" }))).toBe(true);
        expect(azureOpenAIAdapter.matches(makeProvider({ baseUrl: "https://my-res.openai.azure.com/" }))).toBe(true);
    });

    it("does not match Azure Foundry inference hosts", () => {
        expect(azureOpenAIAdapter.matches(makeProvider({ baseUrl: "https://my-res.inference.ai.azure.com" }))).toBe(false);
    });

    it("does not match plain OpenAI hosts", () => {
        expect(azureOpenAIAdapter.matches(makeProvider({ baseUrl: "https://api.openai.com/v1" }))).toBe(false);
    });

    it("returns false (not throw) for an unparsable base_url", () => {
        expect(azureOpenAIAdapter.matches(makeProvider({ baseUrl: "not a url" }))).toBe(false);
    });
});

describe("adapters/azure-openai — upstreamUrl / upstreamHeaders", () => {
    it("wraps the URL with the encoded deployment name, variant path, and api-version", () => {
        const args = makeArgs({ provider: makeProvider({ baseUrl: "https://my-res.openai.azure.com", apiVersion: "2024-06-01" }) });
        expect(azureOpenAIAdapter.upstreamUrl(args)).toBe(
            "https://my-res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2024-06-01",
        );
    });

    it("URL-encodes deployment names containing special characters", () => {
        const args = makeArgs({ model: makeModel({ upstreamModelId: "my deployment/v1" }) });
        expect(azureOpenAIAdapter.upstreamUrl(args)).toContain(encodeURIComponent("my deployment/v1"));
    });

    it("falls back to the default api-version when provider.apiVersion is null, empty, or whitespace", () => {
        for (const apiVersion of [null, "", "   "]) {
            const args = makeArgs({ provider: makeProvider({ baseUrl: "https://my-res.openai.azure.com", apiVersion }) });
            expect(azureOpenAIAdapter.upstreamUrl(args)).toContain("api-version=2024-10-21");
        }
    });

    it("trims whitespace around an explicit apiVersion", () => {
        const args = makeArgs({ provider: makeProvider({ baseUrl: "https://my-res.openai.azure.com", apiVersion: "  2023-05-15  " }) });
        expect(azureOpenAIAdapter.upstreamUrl(args)).toContain("api-version=2023-05-15");
    });

    it("sets api-key header only when an apiKey is present, always sets Content-Type", () => {
        const args = makeArgs();
        expect(azureOpenAIAdapter.upstreamHeaders(args, "secret-key")).toEqual({
            "Content-Type": "application/json",
            "api-key": "secret-key",
        });
        const noKey = azureOpenAIAdapter.upstreamHeaders(args, null);
        expect(noKey).toEqual({ "Content-Type": "application/json" });
        expect("api-key" in noKey).toBe(false);
    });
});

describe("adapters/azure-openai — resourceUrl / resourceHeaders", () => {
    it("wraps resource paths with deployment + api-version, appending query with &", () => {
        const args: ResourceCallArgs = {
            provider: makeProvider({ baseUrl: "https://my-res.openai.azure.com", apiVersion: "2024-06-01" }),
            model: makeModel({ upstreamModelId: "sora-deployment" }),
            path: "/videos/abc123",
        };
        expect(azureOpenAIAdapter.resourceUrl!(args)).toBe(
            "https://my-res.openai.azure.com/openai/deployments/sora-deployment/videos/abc123?api-version=2024-06-01",
        );
        expect(azureOpenAIAdapter.resourceUrl!({ ...args, query: "foo=bar" })).toBe(
            "https://my-res.openai.azure.com/openai/deployments/sora-deployment/videos/abc123?api-version=2024-06-01&foo=bar",
        );
    });

    it("resourceHeaders only ever sets api-key, never Content-Type or Authorization", () => {
        const args: ResourceCallArgs = { provider: makeProvider(), model: makeModel(), path: "/x" };
        expect(azureOpenAIAdapter.resourceHeaders!(args, "secret")).toEqual({ "api-key": "secret" });
        expect(azureOpenAIAdapter.resourceHeaders!(args, null)).toEqual({});
    });
});

describe("adapters/azure-openai — finalizeRequest", () => {
    it("strips the model field (Azure routes via deployment URL) and preserves the rest", () => {
        const args = makeArgs();
        const out = azureOpenAIAdapter.finalizeRequest!({ model: "gpt-4o", temperature: 0.7, stream: true }, args);
        expect(out).toEqual({ temperature: 0.7, stream: true });
        expect("model" in out).toBe(false);
    });

    it("is a no-op when body has no model field", () => {
        const args = makeArgs();
        const out = azureOpenAIAdapter.finalizeRequest!({ temperature: 0.7 }, args);
        expect(out).toEqual({ temperature: 0.7 });
    });
});

describe("adapters/azure-openai — extractModelMeta", () => {
    it("flags chat:false because Azure OpenAI /openai/models returns base model names, not deployments", () => {
        const meta = azureOpenAIAdapter.extractModelMeta({ id: "gpt-4o", owned_by: "azure" }, makeProvider());
        expect(meta).toEqual({
            upstream_id: "gpt-4o",
            label: "gpt-4o",
            supported_apis: [],
            capabilities: { chat: false },
            owned_by: "azure",
            raw: { id: "gpt-4o", owned_by: "azure" },
        });
    });

    it("returns null when id is missing or not a string", () => {
        expect(azureOpenAIAdapter.extractModelMeta({}, makeProvider())).toBeNull();
        expect(azureOpenAIAdapter.extractModelMeta({ id: 42 }, makeProvider())).toBeNull();
    });

    it("defaults owned_by to null when absent or not a string", () => {
        const meta = azureOpenAIAdapter.extractModelMeta({ id: "gpt-4o" }, makeProvider())!;
        expect(meta.owned_by).toBeNull();
    });
});

describe("adapters/azure-openai — fetchModels", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    it("hits /openai/models with api-version query and api-key header", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "gpt-4o" }] }) });
        const provider = makeProvider({ baseUrl: "https://my-res.openai.azure.com/", apiVersion: "2024-06-01" });
        const models = await azureOpenAIAdapter.fetchModels(provider, "secret-key");
        expect(models).toEqual([{ id: "gpt-4o" }]);
        const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe("https://my-res.openai.azure.com/openai/models?api-version=2024-06-01");
        expect(options.headers).toEqual({ Accept: "application/json", "api-key": "secret-key" });
    });

    it("omits api-key when apiKey is null", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
        await azureOpenAIAdapter.fetchModels(makeProvider(), null);
        const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(options.headers).toEqual({ Accept: "application/json" });
    });

    it("returns a bare array root verbatim", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [{ id: "x" }] });
        const models = await azureOpenAIAdapter.fetchModels(makeProvider(), null);
        expect(models).toEqual([{ id: "x" }]);
    });

    it("returns [] when the payload has no data array and isn't an array itself", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ foo: "bar" }) });
        const models = await azureOpenAIAdapter.fetchModels(makeProvider(), null);
        expect(models).toEqual([]);
    });

    it("throws including the HTTP status when the response is not ok", async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401 });
        await expect(azureOpenAIAdapter.fetchModels(makeProvider({ baseUrl: "https://my-res.openai.azure.com" }), null))
            .rejects.toThrow(/models discovery HTTP 401/);
    });
});

describe("adapters/azure-openai — descriptor", () => {
    it("has the expected id/label", () => {
        expect(azureOpenAIAdapter.id).toBe("azure-openai");
        expect(azureOpenAIAdapter.label).toBeTruthy();
    });
});
