import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ISO-8601 with milliseconds and explicit `Z` so timestamps written
// via the column default match what `new Date().toISOString()`
// produces on every other write path. Without this, rows created
// via the SQLite default land as `2024-01-15 12:34:56` (no T, no Z,
// no fractional) and don't round-trip with rows the app writes
// explicitly — POST-create returns ISO while subsequent GET-list
// returns SQLite-naive, breaking client-side equality / sort /
// dedupe by created_at.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    createdAt: text("created_at").notNull().default(now),
});

export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: text("created_at").notNull().default(now),
}, (t) => [
    index("sessions_user_idx").on(t.userId),
    // Hot-path: `purgeExpired()` runs `DELETE WHERE expires_at < now`
    // on every login. Without this index SQLite full-scans the table
    // every time; with N sessions accumulated over months that scan
    // becomes the bottleneck of the login response.
    index("sessions_expires_idx").on(t.expiresAt),
]);

export const apiKeys = sqliteTable("api_keys", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    lastUsedAt: text("last_used_at"),
    /** Optional ISO timestamp after which the key is invalid. `null`
     *  means never expires (legacy behaviour). bearer auth checks this
     *  before accepting the token. */
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(now),
}, (t) => [
    index("api_keys_user_idx").on(t.userId),
]);

export const providers = sqliteTable("providers", {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    /** Adapter id from lib/server/adapters/. Auto-detected at write time
     *  when empty; the value is free text so users can register custom
     *  adapters without a schema change. */
    adapterId: text("adapter_id").notNull().default("openai"),
    baseUrl: text("base_url").notNull(),
    apiVersion: text("api_version"),
    apiKeyEncrypted: text("api_key_encrypted"),
    defaultParams: text("default_params", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    httpProxy: text("http_proxy", { mode: "json" }).$type<Record<string, string> | null>(),
    documentPage: text("document_page"),
    modelPage: text("model_page"),
    /** Optional full URL that returns `{"status": "ok"}` when the upstream
     *  is healthy. When set, the provider "Check" action GETs this URL
     *  instead of probing /models. */
    healthCheckUrl: text("health_check_url"),
    /** Result of the most recent health-check probe. "ok" | "down" | null
     *  when the provider has never been checked or has no health_check_url. */
    lastHealthStatus: text("last_health_status", { enum: ["ok", "down"] }),
    /** ISO timestamp of the last health-check probe (regardless of result). */
    lastHealthCheckedAt: text("last_health_checked_at"),
    /** First-line of the upstream error on the last failed probe. Cleared on success. */
    lastHealthError: text("last_health_error"),
    isLocal: integer("is_local", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
});

export const models = sqliteTable("models", {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    providerId: text("provider_id").notNull().references(() => providers.id, { onDelete: "cascade" }),
    upstreamModelId: text("upstream_model_id").notNull(),
    // Capability id (chat | embedding | image | audio.speech | audio.transcription | rerank | ...).
    // Free text so adding a new capability does not require a schema migration.
    type: text("type").notNull().default("chat"),
    defaultParams: text("default_params", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    contextWindow: integer("context_window"),
    maxTokens: integer("max_tokens"),
    outputDimension: integer("output_dimension"),
    pricing: text("pricing", { mode: "json" }).$type<Record<string, unknown> | null>(),
    description: text("description"),
    knowledgeDate: text("knowledge_date"),
    timeout: integer("timeout").notNull().default(3600),
    maxRetries: integer("max_retries").notNull().default(2),
    httpProxy: text("http_proxy", { mode: "json" }).$type<Record<string, string> | null>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Pinned upstream API variant id (e.g. "chat.completions" / "responses").
     *  When set, overrides the gateway's per-request variant selection
     *  for this model. When null, the gateway picks via
     *  capability.variantPreference + model.meta.supported_apis. */
    apiVariantId: text("api_variant_id"),
    /** Verbatim entry from the upstream /models endpoint at last discovery.
     *  Adapter-specific shape, persisted for the admin UI's raw-metadata
     *  panel and for re-running extractModelMeta when adapter logic changes. */
    discoveredMetadata: text("discovered_metadata", { mode: "json" }).$type<unknown>(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
}, (t) => [
    index("models_provider_idx").on(t.providerId),
    index("models_type_idx").on(t.type),
]);

export const conversations = sqliteTable("conversations", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Chat"),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    groupId: text("group_id"),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
}, (t) => [
    index("conversations_user_idx").on(t.userId),
    index("conversations_updated_idx").on(t.updatedAt),
    // Hot path: list endpoint filters by (user_id, is_deleted) and
    // sorts by updated_at DESC. The composite index turns the scan
    // into an index seek + ordered range read.
    index("conversations_user_active_updated_idx").on(t.userId, t.isDeleted, t.updatedAt),
]);

export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
    content: text("content", { mode: "json" }).$type<unknown[] | string>().notNull(),
    reasoningContent: text("reasoning_content"),
    modelId: text("model_id"),
    generationId: text("generation_id"),
    parentId: text("parent_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    rating: text("rating", { enum: ["up", "down"] }),
    feedback: text("feedback"),
    /** Non-null = failed generation; rendered as error card client-side. */
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
}, (t) => [
    index("messages_conv_idx").on(t.conversationId),
    index("messages_parent_idx").on(t.parentId),
    // Hot path: paginated message reads filter by (conversation_id,
    // is_active) and sort by created_at — same scan-vs-seek win.
    index("messages_conv_active_created_idx").on(t.conversationId, t.isActive, t.createdAt),
]);

export const generationLogs = sqliteTable("generation_logs", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    modelName: text("model_name").notNull(),
    capability: text("capability"),
    status: text("status", { enum: ["pending", "completed", "failed"] }).notNull().default("pending"),
    input: text("input", { mode: "json" }).$type<unknown>(),
    inputSummary: text("input_summary"),
    output: text("output"),
    reason: text("reason"),
    generationKwargs: text("generation_kwargs", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    generation: text("generation", { mode: "json" }).$type<Record<string, unknown> | null>(),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    firstTokenLatencyMs: integer("first_token_latency_ms"),
    totalLatencyMs: integer("total_latency_ms"),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
}, (t) => [
    index("gen_logs_user_idx").on(t.userId),
    index("gen_logs_model_idx").on(t.modelName),
    index("gen_logs_status_idx").on(t.status),
    index("gen_logs_capability_idx").on(t.capability),
    index("gen_logs_created_idx").on(t.createdAt),
    // Hot path: the logs list page filters by (user_id?, capability?,
    // status?) + is_deleted=false and always sorts by created_at DESC.
    // Composite indexes covering the common filter prefixes turn the
    // scan-and-sort into a single index range read.
    index("gen_logs_user_deleted_created_idx").on(t.userId, t.isDeleted, t.createdAt),
    index("gen_logs_cap_deleted_created_idx").on(t.capability, t.isDeleted, t.createdAt),
    index("gen_logs_status_deleted_created_idx").on(t.status, t.isDeleted, t.createdAt),
    // The three composites above all lead with a filter column, so none of
    // them serves the *unfiltered* admin view (`is_deleted=0 ORDER BY
    // created_at DESC`) or the stats window (`is_deleted=0 AND created_at
    // >= ?`). Those fell back to a full index scan / full table scan that
    // grew with total history rather than with the requested window.
    index("gen_logs_deleted_created_idx").on(t.isDeleted, t.createdAt),
]);

export const userPreferences = sqliteTable("user_preferences", {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    preferences: text("preferences", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: text("updated_at").notNull().default(now),
});

// =============================================================================
// Tools — hand-written JSON Schema function definitions. Server invokes
// the optional webhook_url with `{tool_call_id, name, arguments}` and
// expects a JSON `{content}` response (or any JSON, stringified for the
// upstream tool message). When webhook_url is null, the tool is
// declaration-only — the user is responsible for handling the call
// outside loom (or it gets fed back as an empty result).
// =============================================================================
export const tools = sqliteTable("tools", {
    id: text("id").primaryKey(),
    /** snake_case function name as passed upstream — must be unique. */
    name: text("name").notNull().unique(),
    /** Single-line user-facing description, also forwarded as the
     *  function's `description` to the model. */
    description: text("description").notNull().default(""),
    /** JSON Schema for the function parameters object. Forwarded as
     *  `function.parameters` in the upstream `tools[]` array. */
    parameters: text("parameters", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    /** Optional HTTPS endpoint invoked by the server when the model
     *  emits a call for this tool. POST `{tool_call_id, name, arguments}`,
     *  expects a JSON body forwarded back to the model. Null = no
     *  execution wiring (declaration-only). */
    webhookUrl: text("webhook_url"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
});

// =============================================================================
// MCP servers — Model Context Protocol server registrations. The loom
// server manages each server's lifecycle (stdio child process or HTTP
// client) and bridges the model's tool_calls to the right server.
// =============================================================================
export const mcpServers = sqliteTable("mcp_servers", {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull().default(""),
    /** "stdio" or "http". Discriminator for the `config` blob. */
    transport: text("transport", { enum: ["stdio", "http"] }).notNull(),
    /** Transport-specific config.
     *  stdio: `{ command: string, args?: string[], env?: Record<string,string>, cwd?: string }`
     *  http:  `{ url: string, headers?: Record<string,string> }` */
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Last health check result. `null` means "never checked". Mirrors
     *  the providers.last_health_* pattern so the FE can render a pill
     *  on the table + a status block on the details sheet. */
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckAt: text("last_check_at"),
    lastCheckError: text("last_check_error"),
    /** Snapshot of `tools/list` from the last successful check, so the
     *  details sheet can render the catalogue without spawning the
     *  process every time it opens. */
    toolsCache: text("tools_cache", { mode: "json" }).$type<Array<{
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    }> | null>(),
    /** Snapshot of `resources/list` (static URIs) + `resources/
     *  templates/list` (URI templates). Same lifecycle as
     *  `toolsCache`. Only fetched when the server advertises the
     *  `resources` capability. */
    resourcesCache: text("resources_cache", { mode: "json" }).$type<{
        resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
        templates: Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }>;
    } | null>(),
    /** Snapshot of `prompts/list`. Only fetched when the server
     *  advertises the `prompts` capability. */
    promptsCache: text("prompts_cache", { mode: "json" }).$type<Array<{
        name: string;
        description?: string;
        arguments?: Array<{ name: string; description?: string; required?: boolean }>;
    }> | null>(),
    /** Server-provided identity from the initialize handshake:
     *  `{ name, version }` from `serverInfo`, plus the optional
     *  `instructions` field — server's own usage description, and
     *  the negotiated `capabilities` map so the details sheet can
     *  show what the server supports beyond tools (resources,
     *  prompts, logging, …). Saves the admin from typing this. */
    serverInfo: text("server_info", { mode: "json" }).$type<{
        name?: string;
        version?: string;
        instructions?: string;
        capabilities?: Record<string, unknown>;
    } | null>(),
    /** Stable sentinel that advances ONLY when transport / config
     *  changes — distinct from `updatedAt` (which is row mtime and
     *  bumps on any field edit). The runtime state machine uses
     *  `configVersion` to decide "the live connection is built against
     *  stale config; tear down and rebuild". Renames / description
     *  edits keep the same `configVersion` so the cached child process
     *  isn't pointlessly respawned. */
    configVersion: text("config_version").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type GenerationLog = typeof generationLogs.$inferSelect;
export type NewGenerationLog = typeof generationLogs.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;
export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;
