import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`CURRENT_TIMESTAMP`;

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
]);

export const apiKeys = sqliteTable("api_keys", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull().default(now),
}, (t) => [
    index("api_keys_user_idx").on(t.userId),
]);

export const providers = sqliteTable("providers", {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    type: text("type", { enum: ["openai", "azure"] }).notNull().default("openai"),
    baseUrl: text("base_url").notNull(),
    apiVersion: text("api_version"),
    apiKeyEncrypted: text("api_key_encrypted"),
    defaultParams: text("default_params", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    httpProxy: text("http_proxy", { mode: "json" }).$type<Record<string, string> | null>(),
    documentPage: text("document_page"),
    modelPage: text("model_page"),
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
    timeout: integer("timeout").notNull().default(60),
    maxRetries: integer("max_retries").notNull().default(2),
    httpProxy: text("http_proxy", { mode: "json" }).$type<Record<string, string> | null>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
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
    searchText: text("search_text"),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
}, (t) => [
    index("conversations_user_idx").on(t.userId),
    index("conversations_updated_idx").on(t.updatedAt),
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
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown> | null>(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    rating: text("rating", { enum: ["up", "down"] }),
    feedback: text("feedback"),
    createdAt: text("created_at").notNull().default(now),
}, (t) => [
    index("messages_conv_idx").on(t.conversationId),
    index("messages_parent_idx").on(t.parentId),
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
    content: text("content", { mode: "json" }).$type<unknown>(),
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
]);

export const userPreferences = sqliteTable("user_preferences", {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    preferences: text("preferences", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
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
