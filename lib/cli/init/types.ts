// Discriminated union for each provider type the wizard knows how
// to render. Adding a new provider variant = one new case in this
// union + one render branch in `template.ts` + one prompt branch
// in `provider-prompt.ts`. The wizard / command file stay untouched.

export type ProviderEntry =
    | { kind: "openai"; apiKeyRef: string }
    | { kind: "azure-openai"; baseUrl: string; apiVersion: string; apiKeyRef: string }
    | { kind: "azure-foundry"; baseUrl: string; apiKeyRef: string };
