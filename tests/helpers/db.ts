// Shared database fixtures for the `node` project.
//
// tests/setup/node.ts points LOOM_DB_PATH at a per-file temp database and
// migrations run on first import of lib/server/db, so every suite starts
// from a real, fully-migrated schema. These helpers only handle seeding
// and truncation.

import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/server/db";
import { encryptSecret } from "@/lib/server/crypto";
import type {
    Conversation, GenerationLog, McpServer, Message, Model, Provider, Tool, User,
} from "@/lib/server/db/schema";

/** Child-first order so FK constraints stay satisfied while wiping. */
const TABLES = [
    schema.messages,
    schema.conversations,
    schema.generationLogs,
    schema.apiKeys,
    schema.sessions,
    schema.userPreferences,
    schema.models,
    schema.providers,
    schema.tools,
    schema.mcpServers,
    schema.users,
] as const;

export function resetDb(): void {
    for (const table of TABLES) db.delete(table).run();
}

export function seedUser(overrides: Partial<User> = {}): User {
    const row = {
        id: overrides.id ?? randomUUID(),
        username: overrides.username ?? `user-${randomUUID().slice(0, 8)}`,
        // bcrypt hash of "password" — cheap constant beats hashing per seed.
        passwordHash: overrides.passwordHash ?? "$2b$10$abcdefghijklmnopqrstuv",
        role: overrides.role ?? "user",
        createdAt: overrides.createdAt ?? new Date().toISOString(),
    } satisfies User;
    db.insert(schema.users).values(row).run();
    return row;
}

export function seedAdmin(overrides: Partial<User> = {}): User {
    return seedUser({ role: "admin", ...overrides });
}

export function seedProvider(overrides: Partial<Provider> = {}): Provider {
    const now = new Date().toISOString();
    const row = {
        id: overrides.id ?? randomUUID(),
        name: overrides.name ?? `provider-${randomUUID().slice(0, 8)}`,
        adapterId: overrides.adapterId ?? "openai",
        baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
        apiVersion: overrides.apiVersion ?? null,
        apiKeyEncrypted:
            overrides.apiKeyEncrypted !== undefined
                ? overrides.apiKeyEncrypted
                : encryptSecret("sk-test-upstream-key"),
        defaultParams: overrides.defaultParams ?? {},
        httpProxy: overrides.httpProxy ?? null,
        documentPage: overrides.documentPage ?? null,
        modelPage: overrides.modelPage ?? null,
        healthCheckUrl: overrides.healthCheckUrl ?? null,
        lastHealthStatus: overrides.lastHealthStatus ?? null,
        lastHealthCheckedAt: overrides.lastHealthCheckedAt ?? null,
        lastHealthError: overrides.lastHealthError ?? null,
        isLocal: overrides.isLocal ?? false,
        enabled: overrides.enabled ?? true,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    } satisfies Provider;
    db.insert(schema.providers).values(row).run();
    return row;
}

export function seedModel(overrides: Partial<Model> & { providerId: string }): Model {
    const now = new Date().toISOString();
    const row = {
        id: overrides.id ?? randomUUID(),
        name: overrides.name ?? `model-${randomUUID().slice(0, 8)}`,
        providerId: overrides.providerId,
        upstreamModelId: overrides.upstreamModelId ?? "gpt-4o-mini",
        type: overrides.type ?? "chat",
        defaultParams: overrides.defaultParams ?? {},
        contextWindow: overrides.contextWindow ?? null,
        maxTokens: overrides.maxTokens ?? null,
        outputDimension: overrides.outputDimension ?? null,
        pricing: overrides.pricing ?? null,
        description: overrides.description ?? null,
        knowledgeDate: overrides.knowledgeDate ?? null,
        timeout: overrides.timeout ?? 3600,
        maxRetries: overrides.maxRetries ?? 2,
        httpProxy: overrides.httpProxy ?? null,
        enabled: overrides.enabled ?? true,
        apiVariantId: overrides.apiVariantId ?? null,
        discoveredMetadata: overrides.discoveredMetadata ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    } satisfies Model;
    db.insert(schema.models).values(row).run();
    return row;
}

export function seedConversation(overrides: Partial<Conversation> & { userId: string }): Conversation {
    const now = new Date().toISOString();
    const row = {
        id: overrides.id ?? randomUUID(),
        userId: overrides.userId,
        title: overrides.title ?? "New Chat",
        config: overrides.config ?? {},
        groupId: overrides.groupId ?? null,
        isDeleted: overrides.isDeleted ?? false,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    } satisfies Conversation;
    db.insert(schema.conversations).values(row).run();
    return row;
}

export function seedMessage(overrides: Partial<Message> & { conversationId: string }): Message {
    const row = {
        id: overrides.id ?? randomUUID(),
        conversationId: overrides.conversationId,
        role: overrides.role ?? "user",
        content: overrides.content ?? "hello",
        reasoningContent: overrides.reasoningContent ?? null,
        modelId: overrides.modelId ?? null,
        generationId: overrides.generationId ?? null,
        parentId: overrides.parentId ?? null,
        isActive: overrides.isActive ?? true,
        rating: overrides.rating ?? null,
        feedback: overrides.feedback ?? null,
        error: overrides.error ?? null,
        createdAt: overrides.createdAt ?? new Date().toISOString(),
    } satisfies Message;
    db.insert(schema.messages).values(row).run();
    return row;
}

export function seedLog(overrides: Partial<GenerationLog> & { userId: string }): GenerationLog {
    const now = new Date().toISOString();
    const row = {
        id: overrides.id ?? randomUUID(),
        userId: overrides.userId,
        modelName: overrides.modelName ?? "gpt-4o-mini",
        capability: overrides.capability ?? "chat",
        status: overrides.status ?? "completed",
        input: overrides.input ?? { messages: [] },
        inputSummary: overrides.inputSummary ?? "hello",
        output: overrides.output ?? "hi",
        reason: overrides.reason ?? null,
        generationKwargs: overrides.generationKwargs ?? {},
        generation: overrides.generation ?? null,
        conversationId: overrides.conversationId ?? null,
        messageId: overrides.messageId ?? null,
        promptTokens: overrides.promptTokens ?? 10,
        completionTokens: overrides.completionTokens ?? 20,
        totalTokens: overrides.totalTokens ?? 30,
        firstTokenLatencyMs: overrides.firstTokenLatencyMs ?? 100,
        totalLatencyMs: overrides.totalLatencyMs ?? 500,
        isDeleted: overrides.isDeleted ?? false,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    } satisfies GenerationLog;
    db.insert(schema.generationLogs).values(row).run();
    return row;
}

export function seedTool(overrides: Partial<Tool> = {}): Tool {
    const now = new Date().toISOString();
    const row = {
        id: overrides.id ?? randomUUID(),
        name: overrides.name ?? `tool_${randomUUID().slice(0, 8).replace(/-/g, "")}`,
        description: overrides.description ?? "a tool",
        parameters: overrides.parameters ?? { type: "object", properties: {} },
        webhookUrl: overrides.webhookUrl ?? null,
        enabled: overrides.enabled ?? true,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    } satisfies Tool;
    db.insert(schema.tools).values(row).run();
    return row;
}

export function seedMcpServer(overrides: Partial<McpServer> = {}): McpServer {
    const now = new Date().toISOString();
    const row = {
        id: overrides.id ?? randomUUID(),
        name: overrides.name ?? `mcp-${randomUUID().slice(0, 8)}`,
        description: overrides.description ?? "",
        transport: overrides.transport ?? "stdio",
        config: overrides.config ?? { command: "echo", args: ["hi"] },
        enabled: overrides.enabled ?? true,
        lastCheckStatus: overrides.lastCheckStatus ?? null,
        lastCheckAt: overrides.lastCheckAt ?? null,
        lastCheckError: overrides.lastCheckError ?? null,
        toolsCache: overrides.toolsCache ?? null,
        resourcesCache: overrides.resourcesCache ?? null,
        promptsCache: overrides.promptsCache ?? null,
        serverInfo: overrides.serverInfo ?? null,
        configVersion: overrides.configVersion ?? "",
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    } satisfies McpServer;
    db.insert(schema.mcpServers).values(row).run();
    return row;
}

/** A SessionUser as produced by the auth layer. */
export function sessionUser(user: User) {
    return { id: user.id, username: user.username, role: user.role };
}
