// Shared model fixture builder for `tests/dom/playground/modalities/**`.
// NOT a test file itself (no `.test.` in the name) so vitest's
// `include: ["tests/dom/**/*.test.{ts,tsx}"]` glob skips it.
import type { ModelDTO } from "@/lib/schemas/model"

/** Builds a minimal, schema-valid `ModelDTO` fixture with sane defaults,
 *  overridable per test. Mirrors the shape used by
 *  `tests/dom/playground/shared/modality-model-selector.test.tsx`. */
export function makeModel(overrides: Partial<ModelDTO> = {}): ModelDTO {
    return {
        id: "model_1",
        name: "test-model",
        model_id: "test-model",
        proxy: null,
        timeout: 30,
        max_retries: 2,
        default_params: {},
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: null,
        pricing: null,
        output_dimension: null,
        context_window: null,
        max_tokens: null,
        description: null,
        knowledge_date: null,
        provider: "openai",
        provider_id: "provider_1",
        is_local: false,
        enabled: true,
        ...overrides,
    }
}
