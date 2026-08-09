// Shared fixture DTOs for tests/dom/playground-modality/**. NOT a test
// file itself. `makeModel` matches `modelDTOSchema` (lib/schemas/model.ts)
// field-for-field (including nullability) so components under test receive
// exactly the shape the real API would return.
import type { ModelDTO } from "@/lib/schemas/model";

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

export const chatModelGpt4o = makeModel({
    id: "model-1",
    name: "gpt-4o",
    model_id: "gpt-4o-2024-08-06",
    provider: "openai",
    type: "chat",
});

export const imageModelDalle3 = makeModel({
    id: "model-i1",
    name: "dall-e-3",
    model_id: "dall-e-3",
    provider: "openai",
    type: "image",
});

export const imageModelSdxl = makeModel({
    id: "model-i2",
    name: "stable-diffusion-xl",
    model_id: "sdxl-1.0",
    provider: "stability",
    provider_id: "prov-3",
    type: "image",
});

export const imageModelGptImage = makeModel({
    id: "model-i4",
    name: "gpt-image-1",
    model_id: "gpt-image-1",
    provider: "openai",
    provider_id: "prov-1",
    type: "image",
});

export const imageModelDisabled = makeModel({
    id: "model-i3",
    name: "disabled-image-model",
    model_id: "disabled-image",
    provider: "openai",
    type: "image",
    enabled: false,
});

export const embeddingModelSmall = makeModel({
    id: "model-e1",
    name: "text-embedding-3-small",
    model_id: "text-embedding-3-small",
    provider: "openai",
    type: "embedding",
});

// Provider/model_id are both nullable per modelDTOSchema — exercises the
// `m.provider ?? "?"` / `(m.model_id ?? "").toLowerCase()...` fallback
// branches in both selectors' row + chip rendering and search filter.
export const imageModelSparse = makeModel({
    id: "model-i5",
    name: "sparse-image-model",
    model_id: null,
    provider: null,
    provider_id: "prov-5",
    type: "image",
});

// A "chat"-typed model whose *name* matches the image heuristic
// (`/flux/i`, see modality-filters.ts) even though its discovery `type`
// disagrees. Exercises the heuristic-fallback branch of `matchesCapability`
// plus the "type !== capability" badge rendered on catalog rows.
export const heuristicImageModel = makeModel({
    id: "model-h1",
    name: "flux-pro",
    model_id: "flux-pro-v1",
    provider: "blackforest",
    provider_id: "prov-4",
    type: "chat",
});
