# Providers

A **provider** is one upstream service that speaks an OpenAI-compatible protocol. Loom currently auto-detects three protocol variants:

| Adapter         | Used for                                            |
| --------------- | --------------------------------------------------- |
| `openai`        | OpenAI, DeepSeek, Groq, Together, vLLM, Ollama, …  |
| `azure-openai`  | Azure OpenAI Service deployments                    |
| `azure-foundry` | Azure AI Foundry (Inference) — partner / OSS models |

When the `adapter_id` field is empty, Loom picks one based on the `base_url`. You can override it explicitly.

## Register via config file

```yaml
providers:
  - name: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}

  - name: azure-eastus
    adapter_id: azure-openai
    base_url: https://my-resource.openai.azure.com
    api_version: "2024-10-21"
    api_key: ${AZURE_OPENAI_API_KEY}

  - name: foundry
    adapter_id: azure-foundry
    base_url: https://my-foundry.services.ai.azure.com
    api_key: ${AZURE_FOUNDRY_API_KEY}
```

Names are unique. Re-running with the same name updates the row.

## Register via admin UI

Visit `/providers` after logging in:

- Add / edit / delete providers
- Each provider exposes a "Re-check" button that probes the upstream and surfaces the error if any
- Per-provider `default_params` apply to every model under that provider
- Optional `health_check_url` makes the homepage health pill turn green only when the dedicated endpoint returns `{"status":"ok"}`; without it, Loom probes the discovery endpoint

## Per-model overrides

Most use of the admin UI's **Models** tab is optional. You only need to register a row when you want to:

- Pin a friendly display name (e.g. `gpt-4o-mini` → "ChatGPT mini")
- Map a logical name to an Azure deployment ID
- Override default params (temperature, `stream_options`, etc.) just for that model
- Change the `adapter_id` for one specific model

Model defaults **inherit** the provider's defaults; setting a field here overrides the provider per-key.

## Storing keys

Loom encrypts every stored API key with AES-256-GCM, using a key derived from `master_key` in your config. The encrypted blob lives in SQLite. Reading a key requires the same `master_key`, so rotating it invalidates everything.

## Adding a new protocol variant

Loom keeps its gateway core free of provider-specific branches. Adding support for a new upstream protocol is one new file in `lib/server/adapters/<id>.ts`:

```ts
registerAdapter({
    id: "anthropic",
    matches: (p) => p.base_url.includes("anthropic.com"),
    transformRequest: (body, modality) => { /* … */ },
    selectUpstreamApi: (modality) => "/v1/messages",
    acceptedFields: { /* whitelist */ },
});
```

Then `import "./anthropic"` from `lib/server/adapters/register.ts`. The gateway, capability handlers, and admin UI dropdown all pick it up automatically.

See [Architecture → Adapter layer](../architecture.md#adapter-layer) for details.
