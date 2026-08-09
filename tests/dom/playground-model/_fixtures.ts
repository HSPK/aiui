// Shared fixture DTOs for tests/dom/playground-model/**. NOT a test file
// itself. Every builder matches its zod schema in lib/schemas/*.ts
// field-for-field (including nullability) so components under test receive
// exactly the shape the real API would return.
import type { ModelDTO } from "@/lib/schemas/model";
import type { ConversationDTO } from "@/lib/schemas/conversation";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";

export function makeModel(overrides: Partial<ModelDTO> = {}): ModelDTO {
    return {
        id: "model-1",
        name: "gpt-4o",
        model_id: "gpt-4o-2024-08-06",
        proxy: "https://api.openai.com/v1",
        timeout: 60,
        max_retries: 2,
        default_params: {},
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: "chat.completions",
        pricing: null,
        output_dimension: null,
        context_window: 128_000,
        max_tokens: 16_384,
        description: null,
        knowledge_date: null,
        provider: "openai",
        provider_id: "prov-1",
        is_local: false,
        enabled: true,
        is_discovered: false,
        meta: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

export const chatModelGpt4o = makeModel({ id: "model-1", name: "gpt-4o", provider: "openai" });
export const chatModelClaude = makeModel({
    id: "model-2",
    name: "claude-3-opus",
    provider: "claude",
    provider_id: "prov-2",
});
export const chatModelGpt35 = makeModel({
    id: "model-3",
    name: "gpt-3.5-turbo",
    provider: "openai",
});
export const chatModelDisabled = makeModel({
    id: "model-4",
    name: "disabled-model",
    provider: "openai",
    enabled: false,
});
export const embeddingModel = makeModel({
    id: "model-5",
    name: "text-embedding-3-small",
    provider: "openai",
    type: "embedding",
});

export function makeConversation(overrides: Partial<ConversationDTO> = {}): ConversationDTO {
    return {
        id: "conv-1",
        user_id: "user-1",
        title: "My conversation",
        config: {},
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        is_deleted: false,
        ...overrides,
    };
}

export function makePreferences(overrides: Partial<UserPreferencesDTO> = {}): UserPreferencesDTO {
    return { ...defaultUserPreferences, ...overrides };
}

/** Pagination envelope matching `Paginated<T>`. */
export function paginated<T>(items: T[], opts?: { page?: number; page_size?: number; total?: number }) {
    return {
        items,
        total: opts?.total ?? items.length,
        page: opts?.page ?? 1,
        page_size: opts?.page_size ?? 20,
    };
}
