import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
    select: vi.fn(),
    text: vi.fn(),
    password: vi.fn(),
    cancel: vi.fn(),
    isCancel: (v: unknown) => v === CANCEL,
}));

import { password, select, text } from "@clack/prompts";
import { promptProvider } from "@/lib/cli/init/provider-prompt";

describe("lib/cli/init/provider-prompt: promptProvider", () => {
    beforeEach(() => {
        vi.mocked(select).mockReset();
        vi.mocked(text).mockReset();
        vi.mocked(password).mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns null when the user picks 'skip' (no further prompts)", async () => {
        vi.mocked(select).mockResolvedValueOnce("skip");

        const result = await promptProvider();

        expect(result).toBeNull();
        expect(select).toHaveBeenCalledTimes(1);
        expect(text).not.toHaveBeenCalled();
        expect(password).not.toHaveBeenCalled();
    });

    it("openai + env key mode (default env var name) -> {kind:openai, apiKeyRef}", async () => {
        vi.mocked(select)
            .mockResolvedValueOnce("openai") // provider kind
            .mockResolvedValueOnce("env"); // api key mode
        vi.mocked(text).mockResolvedValueOnce("OPENAI_API_KEY"); // env var name (default accepted)

        const result = await promptProvider();

        expect(result).toEqual({ kind: "openai", apiKeyRef: "${OPENAI_API_KEY}" });
        expect(password).not.toHaveBeenCalled();
        // Only one text() prompt for openai's env-var name — no baseUrl/apiVersion.
        expect(text).toHaveBeenCalledTimes(1);
        expect(vi.mocked(text).mock.calls[0][0]).toMatchObject({
            message: "Env var name",
            placeholder: "OPENAI_API_KEY",
            initialValue: "OPENAI_API_KEY",
        });
    });

    it("openai + inline key mode -> {kind:openai, apiKeyRef: <literal>}", async () => {
        vi.mocked(select)
            .mockResolvedValueOnce("openai")
            .mockResolvedValueOnce("inline");
        vi.mocked(password).mockResolvedValueOnce("sk-literal-123");

        const result = await promptProvider();

        expect(result).toEqual({ kind: "openai", apiKeyRef: "sk-literal-123" });
        expect(text).not.toHaveBeenCalled();
        expect(vi.mocked(password).mock.calls[0][0]).toMatchObject({
            message: expect.stringContaining("API key"),
        });
    });

    it("azure-openai + custom env var name -> full entry incl. apiVersion", async () => {
        vi.mocked(select)
            .mockResolvedValueOnce("azure-openai")
            .mockResolvedValueOnce("env");
        vi.mocked(text)
            .mockResolvedValueOnce("MY_CUSTOM_KEY") // env var name
            .mockResolvedValueOnce("https://x.openai.azure.com") // baseUrl
            .mockResolvedValueOnce("2023-05-15"); // apiVersion

        const result = await promptProvider();

        expect(result).toEqual({
            kind: "azure-openai",
            baseUrl: "https://x.openai.azure.com",
            apiVersion: "2023-05-15",
            apiKeyRef: "${MY_CUSTOM_KEY}",
        });
        expect(text).toHaveBeenCalledTimes(3);
        expect(vi.mocked(text).mock.calls[0][0]).toMatchObject({ placeholder: "AZURE_OPENAI_API_KEY" });
        expect(vi.mocked(text).mock.calls[1][0]).toMatchObject({
            message: "Azure OpenAI endpoint",
            placeholder: "https://my-resource.openai.azure.com",
        });
        expect(vi.mocked(text).mock.calls[2][0]).toMatchObject({
            message: "API version",
            initialValue: "2024-10-21",
        });
    });

    it("azure-foundry + inline key -> entry without apiVersion, foundry endpoint copy", async () => {
        vi.mocked(select)
            .mockResolvedValueOnce("azure-foundry")
            .mockResolvedValueOnce("inline");
        vi.mocked(password).mockResolvedValueOnce("foundry-secret");
        vi.mocked(text).mockResolvedValueOnce("https://my-foundry.services.ai.azure.com");

        const result = await promptProvider();

        expect(result).toEqual({
            kind: "azure-foundry",
            baseUrl: "https://my-foundry.services.ai.azure.com",
            apiKeyRef: "foundry-secret",
        });
        expect(text).toHaveBeenCalledTimes(1);
        expect(vi.mocked(text).mock.calls[0][0]).toMatchObject({
            message: "Foundry endpoint",
            placeholder: "https://my-foundry.services.ai.azure.com",
        });
    });

    it("uses AZURE_FOUNDRY_API_KEY as the default env var name for azure-foundry", async () => {
        vi.mocked(select)
            .mockResolvedValueOnce("azure-foundry")
            .mockResolvedValueOnce("env");
        vi.mocked(text)
            .mockResolvedValueOnce("AZURE_FOUNDRY_API_KEY")
            .mockResolvedValueOnce("https://f.services.ai.azure.com");

        const result = await promptProvider();

        expect(result).toMatchObject({ apiKeyRef: "${AZURE_FOUNDRY_API_KEY}" });
        expect(vi.mocked(text).mock.calls[0][0]).toMatchObject({ placeholder: "AZURE_FOUNDRY_API_KEY" });
    });

    describe("inline validators", () => {
        it("baseUrl validator accepts http(s):// and rejects everything else", async () => {
            vi.mocked(select)
                .mockResolvedValueOnce("azure-openai")
                .mockResolvedValueOnce("env");
            vi.mocked(text)
                .mockResolvedValueOnce("AZURE_OPENAI_API_KEY")
                .mockResolvedValueOnce("https://ok.example.com")
                .mockResolvedValueOnce("2024-10-21");

            await promptProvider();

            const baseUrlCall = vi.mocked(text).mock.calls[1][0] as { validate: (v?: string) => string | undefined };
            expect(baseUrlCall.validate("https://fine.example.com")).toBeUndefined();
            expect(baseUrlCall.validate("http://fine.example.com")).toBeUndefined();
            expect(baseUrlCall.validate("ftp://nope.example.com")).toBe("Must start with http(s)://");
            expect(baseUrlCall.validate(undefined)).toBeUndefined();
        });

        it("env var name validator enforces UPPER_SNAKE_CASE starting with a letter", async () => {
            vi.mocked(select)
                .mockResolvedValueOnce("openai")
                .mockResolvedValueOnce("env");
            vi.mocked(text).mockResolvedValueOnce("OPENAI_API_KEY");

            await promptProvider();

            const nameCall = vi.mocked(text).mock.calls[0][0] as { validate: (v?: string) => string | undefined };
            expect(nameCall.validate("OPENAI_API_KEY")).toBeUndefined();
            expect(nameCall.validate("lowercase")).toBe("Use UPPER_SNAKE_CASE");
            expect(nameCall.validate("1STARTS_WITH_DIGIT")).toBe("Use UPPER_SNAKE_CASE");
            expect(nameCall.validate(undefined)).toBeUndefined();
        });
    });
});
