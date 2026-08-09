// Shared fixture DTOs for tests/dom/admin/**. NOT a test file itself.
// Every object here matches its zod schema in lib/schemas/*.ts field-for-
// field (including nullability) so components under test receive exactly
// the shape the real API would return.
import type { LogDetailDTO, LogListItemDTO } from "@/lib/schemas/log";
import type { ToolDTO } from "@/lib/schemas/tool";
import type { McpPreset, McpRuntimeStatusDTO, McpServerDTO } from "@/lib/schemas/mcp";
import type { ProviderDTO } from "@/lib/schemas/provider";
import type { ModelDTO } from "@/lib/schemas/model";
import type { UserDTO } from "@/lib/schemas/user";
import type { CapabilityDTO } from "@/lib/schemas/capability";
import type { VariantDescriptor } from "@/lib/schemas/variant";
import type { AdapterDescriptor } from "@/lib/schemas/adapter";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";

// ---- logs ----

export const logListItem: LogListItemDTO = {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    user_id: "user-1",
    username: "alice",
    model_name: "gpt-4o",
    capability: "chat",
    input_summary: "Hello there",
    status: "completed",
    input: "Hello there",
    output: "Hi! How can I help?",
    reason: null,
    prompt_tokens: 1200,
    completion_tokens: 450,
    total_tokens: 1650,
    first_token_latency_ms: 320,
    total_latency_ms: 6450,
    created_at: "2024-01-15T10:30:00.000Z",
    updated_at: "2024-01-15T10:30:01.000Z",
    is_deleted: false,
};

export const logListItemNoTokens: LogListItemDTO = {
    ...logListItem,
    id: "aaaaaaaa-0000-0000-0000-000000000002",
    username: null,
    capability: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    first_token_latency_ms: null,
    total_latency_ms: null,
    status: "failed",
};

export const logListItemBigNumbers: LogListItemDTO = {
    ...logListItem,
    id: "aaaaaaaa-0000-0000-0000-000000000003",
    status: "pending",
    prompt_tokens: 1_500_000,
    completion_tokens: 2_000,
    total_tokens: 1_502_000,
    total_latency_ms: 500,
};

/** Comprehensive markdown blob exercising every `logMarkdownComponents`
 *  override: headers h1-h4, bold, strikethrough, link, task list + plain
 *  list, ordered list, blockquote, hr, inline + block code, table. */
export const richMarkdown = `# Title
## Subtitle
### H3
#### H4

Some **bold** text and ~~strikethrough~~ and a [link](https://example.com).

- [ ] todo item
- [x] done item
- plain item

1. first
2. second

> a quote

---

Inline \`code\` and:

\`\`\`js
const x = 1;
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |
`;

export const chatInput = {
    messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
            role: "user",
            content: [
                { type: "text", text: richMarkdown },
                { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
                {
                    type: "file",
                    file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,AAAA", mime_type: "application/pdf" },
                },
            ],
        },
        {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } }],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"temp": 72}' },
        { role: "assistant", content: "" },
    ],
};

export const logDetail: LogDetailDTO = {
    ...logListItem,
    input: chatInput,
    generation_kwargs: { temperature: 0.7, max_tokens: 500 },
    generation: { id: "chatcmpl-1", choices: [{ message: { role: "assistant", content: "Hi! How can I help?" } }] },
    conversation_id: "conv-1",
    message_id: "msg-1",
};

export const logDetailNonChat: LogDetailDTO = {
    ...logListItemNoTokens,
    input: "raw plain-text prompt",
    output: "",
    generation_kwargs: {},
    generation: null,
};

export const logDetailImage: LogDetailDTO = {
    ...logListItem,
    id: "aaaaaaaa-0000-0000-0000-000000000004",
    capability: "image",
    input: { prompt: "a cat astronaut" },
    output: "",
    generation_kwargs: { size: "1024x1024" },
    generation: {
        loom_artifacts: [
            { index: 0, url: "/api/logs/generations/aaaaaaaa-0000-0000-0000-000000000004/artifacts/0", mime: "image/png", bytes: 204_800 },
        ],
    },
};

export const logDetailImageUnsafeUrl: LogDetailDTO = {
    ...logDetailImage,
    id: "aaaaaaaa-0000-0000-0000-000000000005",
    generation: {
        loom_artifacts: [{ index: 0, url: "javascript:alert(1)", mime: "image/png", bytes: 10 }],
    },
};

export const logDetailImageEmpty: LogDetailDTO = {
    ...logDetailImage,
    id: "aaaaaaaa-0000-0000-0000-000000000006",
    generation: {},
};

// ---- tools ----

export const tool: ToolDTO = {
    id: "tool-1",
    name: "get_weather",
    description: "Fetch current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    webhook_url: "https://example.com/webhook",
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
};

export const toolDisabled: ToolDTO = {
    ...tool,
    id: "tool-2",
    name: "disabled_tool",
    description: "",
    webhook_url: null,
    enabled: false,
};

// ---- mcp ----

export const mcpServerStdio: McpServerDTO = {
    id: "mcp-1",
    name: "filesystem",
    description: "Local filesystem access",
    transport: "stdio",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"], env: { TOKEN: "secret-value" } },
    config_decryption_failed: false,
    enabled: true,
    last_check_status: "ok",
    last_check_at: "2024-01-10T00:00:00.000Z",
    last_check_error: null,
    tools_cache: [
        { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
        { name: "write_file", description: "Write a file", parameters: { type: "object", properties: {} } },
    ],
    resources_cache: {
        resources: [{ uri: "file:///data/readme.md", name: "readme", description: "Readme", mimeType: "text/markdown" }],
        templates: [{ uriTemplate: "file:///data/{path}", name: "file template" }],
    },
    prompts_cache: [{ name: "summarize", description: "Summarize a file", arguments: [{ name: "path", required: true }] }],
    server_info: { name: "fs-server", version: "1.0.0", instructions: "Use read_file/write_file", capabilities: { tools: {} } },
    config_version: "v1",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-05T00:00:00.000Z",
};

export const mcpServerHttp: McpServerDTO = {
    ...mcpServerStdio,
    id: "mcp-2",
    name: "remote-http",
    transport: "http",
    config: { url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer secret-token" } },
    last_check_status: "error",
    last_check_error: "connect ECONNREFUSED",
    tools_cache: null,
    resources_cache: null,
    prompts_cache: null,
    server_info: null,
};

export const mcpServerUnchecked: McpServerDTO = {
    ...mcpServerStdio,
    id: "mcp-3",
    name: "never-checked",
    last_check_status: null,
    last_check_at: null,
    tools_cache: null,
    resources_cache: null,
    prompts_cache: null,
    server_info: null,
};

export const mcpServerDecryptFailed: McpServerDTO = {
    ...mcpServerStdio,
    id: "mcp-4",
    name: "broken-secrets",
    config_decryption_failed: true,
};

export const mcpPresetStdio: McpPreset = {
    id: "preset-fs",
    name: "Filesystem",
    description: "Official filesystem MCP server",
    transport: "stdio",
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "<ALLOWED_DIR>"], env: {} },
    slots: [{ path: "args[2]", label: "Allowed directory", kind: "path" }],
    homepage: "https://github.com/modelcontextprotocol/servers",
    category: "official",
};

export const mcpPresetHttp: McpPreset = {
    id: "preset-http",
    name: "Remote API",
    description: "Generic HTTP MCP server",
    transport: "http",
    config: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer <API_KEY>" } },
    slots: [{ path: "headers.Authorization", label: "API key", kind: "secret" }],
    category: "community",
};

export const mcpRuntimeConnected: McpRuntimeStatusDTO = {
    server_id: "mcp-1",
    status: "connected",
    pid: 4242,
    started_at: "2024-01-10T00:00:00.000Z",
    built_for: "2024-01-05T00:00:00.000Z",
    error: null,
    recent_logs: ["[info] spawning", "[info] connected"],
};

export const mcpRuntimeFailed: McpRuntimeStatusDTO = {
    server_id: "mcp-2",
    status: "failed",
    pid: null,
    started_at: null,
    built_for: null,
    error: "spawn ENOENT",
    recent_logs: ["[error] spawn ENOENT"],
};

export const mcpRuntimeIdle: McpRuntimeStatusDTO = {
    server_id: "mcp-3",
    status: "idle",
    pid: null,
    started_at: null,
    built_for: null,
    error: null,
    recent_logs: [],
};

// ---- providers ----

export const providerWithHealth: ProviderDTO = {
    id: "prov-1",
    name: "openai",
    provider_name: "OpenAI",
    adapter_id: "openai",
    base_url: "https://api.openai.com/v1",
    proxy: "https://api.openai.com/v1",
    api_version: null,
    has_api_key: true,
    default_params: {},
    document_page: "https://platform.openai.com/docs",
    model_page: "https://platform.openai.com/docs/models",
    health_check_url: "https://api.openai.com/health",
    last_health_status: "ok",
    last_health_checked_at: "2024-01-10T00:00:00.000Z",
    last_health_error: null,
    is_local: false,
    enabled: true,
    n_models: 12,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
};

export const providerDown: ProviderDTO = {
    ...providerWithHealth,
    id: "prov-2",
    name: "flaky",
    provider_name: "Flaky Co",
    last_health_status: "down",
    last_health_error: "timeout after 5000ms",
};

export const providerUnchecked: ProviderDTO = {
    ...providerWithHealth,
    id: "prov-3",
    name: "fresh",
    provider_name: "Fresh Provider",
    last_health_status: null,
    last_health_checked_at: null,
};

/** No health_check_url at all — the pill must render nothing, even
 *  though `last_health_status` carries a stale "ok" from a check that
 *  ran before the URL was cleared. Used to assert the health-pill gate
 *  can't be fooled by stale sibling fields. */
export const providerNoHealthUrl: ProviderDTO = {
    ...providerWithHealth,
    id: "prov-4",
    name: "no-url",
    provider_name: "No Health URL",
    health_check_url: null,
    last_health_status: "ok",
    last_health_checked_at: "2024-01-01T00:00:00.000Z",
};

export const providerAzure: ProviderDTO = {
    ...providerWithHealth,
    id: "prov-5",
    name: "azure-openai",
    provider_name: "Azure OpenAI",
    adapter_id: "azure-openai",
    api_version: "2024-02-01",
    health_check_url: null,
    last_health_status: null,
    last_health_checked_at: null,
};

// ---- models ----

export const modelOverride: ModelDTO = {
    id: "model-1",
    name: "gpt-4o",
    model_id: "gpt-4o-2024-08-06",
    proxy: "https://api.openai.com/v1",
    timeout: 60,
    max_retries: 2,
    default_params: { temperature: 0.7 },
    type: "chat",
    api_variant_id: "chat.completions",
    resolved_variant_id: "chat.completions",
    pricing: { input: 2.5, output: 10 },
    output_dimension: null,
    context_window: 128_000,
    max_tokens: 16_384,
    description: "OpenAI flagship chat model",
    knowledge_date: "2023-10",
    provider: "OpenAI",
    provider_id: "prov-1",
    is_local: false,
    enabled: true,
    is_discovered: false,
    meta: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
};

export const modelDiscovered: ModelDTO = {
    ...modelOverride,
    id: "gpt-4o-mini",
    name: "gpt-4o-mini",
    model_id: "gpt-4o-mini",
    context_window: 128_000,
    is_discovered: true,
    api_variant_id: null,
    resolved_variant_id: "chat.completions",
    meta: {
        upstream_id: "gpt-4o-mini",
        label: "GPT-4o mini",
        supported_apis: ["chat.completions", "responses"],
        capabilities: { chat: true, vision: true, tools: true },
        raw: { id: "gpt-4o-mini", object: "model" },
    },
};

export const modelDisabled: ModelDTO = {
    ...modelOverride,
    id: "model-2",
    name: "legacy-model",
    enabled: false,
};

// ---- users ----

export const adminUser: UserDTO = {
    username: "admin",
    role: "admin",
    created_at: "2024-01-01T00:00:00.000Z",
};

export const normalUser: UserDTO = {
    username: "bob",
    role: "user",
    created_at: "2024-01-02T00:00:00.000Z",
};

// ---- catalogs ----

export const capabilityChat: CapabilityDTO = {
    id: "chat",
    label: "Chat",
    description: "Conversational chat completion",
    default_variant: "chat.completions",
};

export const capabilityEmbedding: CapabilityDTO = {
    id: "embedding",
    label: "Embedding",
    description: null,
    default_variant: "embeddings",
};

export const capabilities: CapabilityDTO[] = [capabilityChat, capabilityEmbedding];

export const variantChatCompletions: VariantDescriptor = {
    id: "chat.completions",
    capability: "chat",
    path: "/chat/completions",
    supports_streaming: true,
};

export const variantResponses: VariantDescriptor = {
    id: "responses",
    capability: "chat",
    path: "/responses",
    supports_streaming: true,
};

export const variantEmbeddings: VariantDescriptor = {
    id: "embeddings",
    capability: "embedding",
    path: "/embeddings",
    supports_streaming: false,
};

export const variants: VariantDescriptor[] = [variantChatCompletions, variantResponses, variantEmbeddings];

export const adapterOpenAI: AdapterDescriptor = {
    id: "openai",
    label: "OpenAI",
    description: "Standard OpenAI-compatible transport",
};

export const adapterAzure: AdapterDescriptor = {
    id: "azure-openai",
    label: "Azure OpenAI",
    description: "Azure-hosted OpenAI deployments",
};

export const adapters: AdapterDescriptor[] = [adapterOpenAI, adapterAzure];

// ---- preferences ----

export const preferencesDefault: UserPreferencesDTO = { ...defaultUserPreferences };

export const preferencesCustom: UserPreferencesDTO = {
    ...defaultUserPreferences,
    theme_id: "dracula",
    theme_scheme: "dark",
    mcp_auto_check_interval_minutes: 5,
    provider_auto_check_interval_minutes: 10,
};

// ---- pagination helper ----

export function paginated<T>(items: T[], opts?: { page?: number; page_size?: number; total?: number }) {
    return {
        items,
        total: opts?.total ?? items.length,
        page: opts?.page ?? 1,
        page_size: opts?.page_size ?? 20,
    };
}
