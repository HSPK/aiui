// Shared plain-object fixtures for the upstream (adapter / variant /
// capability) test suite. These conform exactly to the Drizzle-inferred
// `Provider` / `Model` shapes without touching the database — the
// adapter/variant/capability layer is pure functions over these types,
// so there's no need to round-trip through SQLite for these tests.
import type { Model, Provider } from "@/lib/server/db/schema";

export function makeProvider(overrides: Partial<Provider> = {}): Provider {
    return {
        id: "provider-1",
        name: "test-provider",
        adapterId: "openai",
        baseUrl: "https://api.example.com/v1",
        apiVersion: null,
        apiKeyEncrypted: null,
        defaultParams: {},
        httpProxy: null,
        documentPage: null,
        modelPage: null,
        healthCheckUrl: null,
        lastHealthStatus: null,
        lastHealthCheckedAt: null,
        lastHealthError: null,
        isLocal: false,
        enabled: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

export function makeModel(overrides: Partial<Model> = {}): Model {
    return {
        id: "model-1",
        name: "test-model",
        providerId: "provider-1",
        upstreamModelId: "gpt-4o-mini",
        type: "chat",
        defaultParams: {},
        contextWindow: null,
        maxTokens: null,
        outputDimension: null,
        pricing: null,
        description: null,
        knowledgeDate: null,
        timeout: 3600,
        maxRetries: 2,
        httpProxy: null,
        enabled: true,
        apiVariantId: null,
        discoveredMetadata: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}
