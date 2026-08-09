import { describe, expect, it, vi } from "vitest";
import "@/lib/server/capabilities/register";
import "@/lib/server/api-variants/register";
import { getCapability } from "@/lib/server/capabilities";
import { getVariant } from "@/lib/server/api-variants";
import { azureFoundryAdapter } from "@/lib/server/adapters/azure-foundry";
import { fetchOpenAIModels } from "@/lib/server/adapters/openai";
import type { ResourceCallArgs, UpstreamCallArgs } from "@/lib/server/adapters";
import { makeModel, makeProvider } from "./fixtures";

const capability = getCapability("chat")!;
const variant = getVariant("chat.completions")!;

function makeArgs(overrides: Partial<UpstreamCallArgs> = {}): UpstreamCallArgs {
    return {
        provider: makeProvider({ baseUrl: "https://my-proj.inference.ai.azure.com" }),
        model: makeModel({ upstreamModelId: "Meta-Llama-3.1-70B-Instruct" }),
        meta: null,
        capability,
        variant,
        stream: false,
        ...overrides,
    };
}

describe("adapters/azure-foundry — matches", () => {
    it("matches *.inference.ai.azure.com", () => {
        expect(azureFoundryAdapter.matches(makeProvider({ baseUrl: "https://my-proj.inference.ai.azure.com" }))).toBe(true);
    });

    it("matches *.services.ai.azure.com", () => {
        expect(azureFoundryAdapter.matches(makeProvider({ baseUrl: "https://my-proj.services.ai.azure.com" }))).toBe(true);
    });

    it("does not match Azure OpenAI (.openai.azure.com) hosts", () => {
        expect(azureFoundryAdapter.matches(makeProvider({ baseUrl: "https://my-res.openai.azure.com" }))).toBe(false);
    });

    it("does not match plain OpenAI hosts", () => {
        expect(azureFoundryAdapter.matches(makeProvider({ baseUrl: "https://api.openai.com/v1" }))).toBe(false);
    });

    it("returns false (not throw) for an unparsable base_url", () => {
        expect(azureFoundryAdapter.matches(makeProvider({ baseUrl: "not a url" }))).toBe(false);
    });
});

describe("adapters/azure-foundry — extractModelMeta — capability mapping", () => {
    it.each([
        ["chatCompletion", "chat.completions"],
        ["responses", "responses"],
        ["embeddings", "embeddings"],
        ["imageGeneration", "images.generations"],
        ["audioSpeech", "audio.speech"],
        ["audioTranscription", "audio.transcriptions"],
        ["rerank", "rerank"],
    ] as const)("maps capabilities.%s → supported_apis [%s]", (capKey, expectedApi) => {
        const meta = azureFoundryAdapter.extractModelMeta({ id: "m1", capabilities: { [capKey]: true } }, makeProvider())!;
        expect(meta.supported_apis).toEqual([expectedApi]);
    });

    it("accepts true, the string 'true', and 1 as truthy capability flags", () => {
        const meta = azureFoundryAdapter.extractModelMeta(
            { id: "m1", capabilities: { chatCompletion: true, embeddings: "true", imageGeneration: 1 } },
            makeProvider(),
        )!;
        expect(meta.supported_apis).toEqual(
            expect.arrayContaining(["chat.completions", "embeddings", "images.generations"]),
        );
        expect(meta.supported_apis).toHaveLength(3);
    });

    it("ignores false / 0 / 'false' capability flags and unknown capability keys", () => {
        const meta = azureFoundryAdapter.extractModelMeta(
            { id: "m1", capabilities: { rerank: false, audioSpeech: 0, audioTranscription: "false", somethingUnknown: true } },
            makeProvider(),
        )!;
        expect(meta.supported_apis).toEqual(["chat.completions"]); // falls back to default
    });

    it("defaults to chat.completions when the capabilities block is empty or absent", () => {
        expect(azureFoundryAdapter.extractModelMeta({ id: "m1", capabilities: {} }, makeProvider())!.supported_apis)
            .toEqual(["chat.completions"]);
        expect(azureFoundryAdapter.extractModelMeta({ id: "m1" }, makeProvider())!.supported_apis)
            .toEqual(["chat.completions"]);
    });
});

describe("adapters/azure-foundry — extractModelMeta — rich metadata", () => {
    it("extracts publisher/format/version/label from the nested model block", () => {
        const meta = azureFoundryAdapter.extractModelMeta(
            {
                id: "Meta-Llama-3.1-70B-Instruct",
                model: { Publisher: "Meta", Format: "custom", Name: "Llama 3.1 70B Instruct", Version: "1" },
                capabilities: { chatCompletion: true },
                owned_by: "meta",
            },
            makeProvider(),
        )!;
        expect(meta.label).toBe("Llama 3.1 70B Instruct");
        expect(meta.publisher).toBe("Meta");
        expect(meta.format).toBe("custom");
        expect(meta.version).toBe("1");
        expect(meta.owned_by).toBe("meta");
        expect(meta.capabilities).toEqual({ chat: true, responses: false, embeddings: false, batch: false });
    });

    it("falls back to id as label and null publisher/format/version when the model block is absent", () => {
        const meta = azureFoundryAdapter.extractModelMeta({ id: "raw-id" }, makeProvider())!;
        expect(meta.label).toBe("raw-id");
        expect(meta.publisher).toBeNull();
        expect(meta.format).toBeNull();
        expect(meta.version).toBeNull();
    });

    it("reads RateLimits (PascalCase) into rate_limits", () => {
        const meta = azureFoundryAdapter.extractModelMeta(
            { id: "m1", RateLimits: { requests: 100, tokens: 50000 } },
            makeProvider(),
        )!;
        expect(meta.rate_limits).toEqual({ requests: 100, tokens: 50000 });
    });

    it("falls back to rate_limits (snake_case) when RateLimits is absent, nulling non-numeric values", () => {
        const meta = azureFoundryAdapter.extractModelMeta(
            { id: "m1", rate_limits: { requests: "not-a-number", tokens: 200 } },
            makeProvider(),
        )!;
        expect(meta.rate_limits).toEqual({ requests: null, tokens: 200 });
    });

    it("defaults rate_limits to {requests:null,tokens:null} when neither key is present", () => {
        const meta = azureFoundryAdapter.extractModelMeta({ id: "m1" }, makeProvider())!;
        expect(meta.rate_limits).toEqual({ requests: null, tokens: null });
    });

    it("sets capabilities.batch only for boolean true or the string 'true' (unlike the api-mapping truthy check)", () => {
        expect(azureFoundryAdapter.extractModelMeta({ id: "m1", capabilities: { batch: true } }, makeProvider())!.capabilities.batch).toBe(true);
        expect(azureFoundryAdapter.extractModelMeta({ id: "m1", capabilities: { batch: "true" } }, makeProvider())!.capabilities.batch).toBe(true);
        expect(azureFoundryAdapter.extractModelMeta({ id: "m1", capabilities: { batch: 1 } }, makeProvider())!.capabilities.batch).toBe(false);
        expect(azureFoundryAdapter.extractModelMeta({ id: "m1", capabilities: { batch: false } }, makeProvider())!.capabilities.batch).toBe(false);
    });

    it("always attaches the accepted/rejected OSS field allowlists", () => {
        const meta = azureFoundryAdapter.extractModelMeta({ id: "m1" }, makeProvider())!;
        expect(meta.accepted_fields).toEqual(expect.arrayContaining(["model", "messages", "temperature"]));
        expect(meta.rejected_fields).toEqual(expect.arrayContaining(["stream_options", "parallel_tool_calls"]));
    });

    it("returns null when id is missing or not a string", () => {
        expect(azureFoundryAdapter.extractModelMeta({}, makeProvider())).toBeNull();
        expect(azureFoundryAdapter.extractModelMeta({ id: 7 }, makeProvider())).toBeNull();
    });

    it("preserves the raw entry verbatim", () => {
        const raw = { id: "m1", capabilities: { chatCompletion: true } };
        expect(azureFoundryAdapter.extractModelMeta(raw, makeProvider())!.raw).toBe(raw);
    });
});

describe("adapters/azure-foundry — URL / header helpers (no deployment wrapping)", () => {
    it("upstreamUrl is base_url + variant.path, without any deployment segment", () => {
        const args = makeArgs({ provider: makeProvider({ baseUrl: "https://my-proj.inference.ai.azure.com/" }) });
        expect(azureFoundryAdapter.upstreamUrl(args)).toBe("https://my-proj.inference.ai.azure.com/chat/completions");
    });

    it("upstreamHeaders sets api-key + Content-Type", () => {
        const args = makeArgs();
        expect(azureFoundryAdapter.upstreamHeaders(args, "secret")).toEqual({
            "Content-Type": "application/json",
            "api-key": "secret",
        });
        const noKey = azureFoundryAdapter.upstreamHeaders(args, null);
        expect(noKey).toEqual({ "Content-Type": "application/json" });
    });

    it("resourceUrl delegates to the shared defaultResourceUrl (flat path, no deployment wrap)", () => {
        const args: ResourceCallArgs = { provider: makeProvider({ baseUrl: "https://my-proj.inference.ai.azure.com" }), model: makeModel(), path: "/videos/1", query: "q=1" };
        expect(azureFoundryAdapter.resourceUrl!(args)).toBe("https://my-proj.inference.ai.azure.com/videos/1?q=1");
    });

    it("resourceHeaders only sets api-key", () => {
        const args: ResourceCallArgs = { provider: makeProvider(), model: makeModel(), path: "/x" };
        expect(azureFoundryAdapter.resourceHeaders!(args, "secret")).toEqual({ "api-key": "secret" });
        expect(azureFoundryAdapter.resourceHeaders!(args, null)).toEqual({});
    });
});

describe("adapters/azure-foundry — finalizeRequest", () => {
    it("stamps the upstream model id (Foundry routes via body.model, no deployment URL)", () => {
        const args = makeArgs({ model: makeModel({ upstreamModelId: "Meta-Llama-3.1-70B-Instruct" }) });
        const out = azureFoundryAdapter.finalizeRequest!({ model: "display-name", temperature: 0.3 }, args);
        expect(out).toEqual({ model: "Meta-Llama-3.1-70B-Instruct", temperature: 0.3 });
    });
});

describe("adapters/azure-foundry — fetchModels", () => {
    it("reuses the shared fetchOpenAIModels implementation (Bearer-style discovery auth)", () => {
        expect(azureFoundryAdapter.fetchModels).toBe(fetchOpenAIModels);
    });

    it("issues a Bearer Authorization header against {base_url}/models when invoked", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "m1" }] }) }));
        const provider = makeProvider({ baseUrl: "https://my-proj.inference.ai.azure.com" });
        const models = await azureFoundryAdapter.fetchModels(provider, "secret-key");
        expect(models).toEqual([{ id: "m1" }]);
        const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe("https://my-proj.inference.ai.azure.com/models");
        expect(options.headers).toEqual({ Accept: "application/json", Authorization: "Bearer secret-key" });
        vi.unstubAllGlobals();
    });
});

describe("adapters/azure-foundry — descriptor", () => {
    it("has the expected id/label/description", () => {
        expect(azureFoundryAdapter.id).toBe("azure-foundry");
        expect(azureFoundryAdapter.label).toBeTruthy();
        expect(azureFoundryAdapter.description).toBeTruthy();
    });
});
