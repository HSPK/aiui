// Provider sub-flow of the init wizard. Returns a fully populated
// `ProviderEntry` (or null if the user opted to skip). Each new
// provider variant gets its own branch here + a render case in
// `template.ts` — the parent wizard never touches this file.

import { password, select, text } from "@clack/prompts";
import { ask, defined } from "./prompts";
import type { ProviderEntry } from "./types";

export async function promptProvider(): Promise<ProviderEntry | null> {
    const kind = (await ask(
        select({
            message: "First provider (you can add more later in the admin UI)",
            options: [
                { value: "openai", label: "OpenAI / compatible (DeepSeek, vLLM, Ollama, …)" },
                { value: "azure-openai", label: "Azure OpenAI" },
                { value: "azure-foundry", label: "Azure AI Foundry" },
                { value: "skip", label: "Skip — I'll add providers later" },
            ],
            initialValue: "openai" as const,
        }),
    )) as "openai" | "azure-openai" | "azure-foundry" | "skip";
    if (kind === "skip") return null;

    const apiKeyRef = await promptApiKey(kind);

    if (kind === "openai") {
        return { kind: "openai", apiKeyRef };
    }

    const baseUrl = await ask(
        text({
            message: kind === "azure-openai" ? "Azure OpenAI endpoint" : "Foundry endpoint",
            placeholder:
                kind === "azure-openai"
                    ? "https://my-resource.openai.azure.com"
                    : "https://my-foundry.services.ai.azure.com",
            validate: defined((v) => (/^https?:\/\//.test(v) ? undefined : "Must start with http(s)://")),
        }),
    );

    if (kind === "azure-openai") {
        const apiVersion = await ask(
            text({
                message: "API version",
                initialValue: "2024-10-21",
            }),
        );
        return { kind: "azure-openai", baseUrl, apiVersion, apiKeyRef };
    }
    return { kind: "azure-foundry", baseUrl, apiKeyRef };
}

async function promptApiKey(kind: "openai" | "azure-openai" | "azure-foundry"): Promise<string> {
    const mode = await ask(
        select({
            message: "API key handling",
            options: [
                { value: "env", label: "Reference an environment variable (recommended)" },
                { value: "inline", label: "Embed literal value in the config file" },
            ],
            initialValue: "env" as const,
        }),
    );

    if (mode === "env") {
        const defaultName =
            kind === "openai"
                ? "OPENAI_API_KEY"
                : kind === "azure-openai"
                    ? "AZURE_OPENAI_API_KEY"
                    : "AZURE_FOUNDRY_API_KEY";
        const name = await ask(
            text({
                message: "Env var name",
                placeholder: defaultName,
                initialValue: defaultName,
                validate: defined((v) => (/^[A-Z][A-Z0-9_]*$/.test(v) ? undefined : "Use UPPER_SNAKE_CASE")),
            }),
        );
        return `\${${name}}`;
    }

    return ask(password({ message: "API key (stored in config file)" }));
}
