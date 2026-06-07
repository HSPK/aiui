import "server-only";
import { forwardGeneration } from "../gateway";
import type { SessionUser } from "../auth";
import type {
    PlaygroundEmbeddingDocScore,
    PlaygroundEmbeddingInput,
    PlaygroundEmbeddingModelResult,
    PlaygroundEmbeddingResult,
} from "@/lib/schemas/playground";

interface UpstreamEmbeddingResponse {
    data?: Array<{ embedding?: number[]; index?: number }>;
    usage?: {
        prompt_tokens?: number;
        total_tokens?: number;
    };
}

function dot(a: number[], b: number[]): number {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}

function magnitude(v: number[]): number {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s);
}

function cosine(a: number[], b: number[]): number {
    const m = magnitude(a) * magnitude(b);
    return m === 0 ? 0 : dot(a, b) / m;
}

/** Wire-format param keys to forward to upstream. Anything unset is
 *  dropped so providers that reject unknown fields stay happy. */
function buildParams(
    input: PlaygroundEmbeddingInput
): Record<string, unknown> {
    const p = input.params ?? {};
    const out: Record<string, unknown> = {};
    if (p.dimensions != null) out.dimensions = p.dimensions;
    if (p.encoding_format) out.encoding_format = p.encoding_format;
    if (p.input_type) out.input_type = p.input_type;
    if (p.user) out.user = p.user;
    return out;
}

/** Upstream embeddings APIs return `data` ordered by `index` in the
 *  request when there are multiple inputs; we still sort defensively
 *  because some providers omit `index` and we'd rather match by
 *  position than risk silently misaligned vectors. */
function alignVectors(
    data: UpstreamEmbeddingResponse["data"],
    totalInputs: number
): Array<number[] | null> {
    const out: Array<number[] | null> = new Array(totalInputs).fill(null);
    if (!data) return out;
    let nextSequential = 0;
    for (const row of data) {
        const idx = typeof row.index === "number" ? row.index : nextSequential;
        if (idx >= 0 && idx < totalInputs) {
            out[idx] = row.embedding ?? null;
        }
        nextSequential++;
    }
    return out;
}

async function runOne(
    user: SessionUser,
    model: string,
    query: string,
    documents: string[],
    params: Record<string, unknown>
): Promise<PlaygroundEmbeddingModelResult> {
    const startedAt = Date.now();
    const totalInputs = 1 + documents.length;
    try {
        const { response } = await forwardGeneration(user, "embedding", {
            ...params,
            model,
            input: [query, ...documents],
        });

        if (!response.ok) {
            const text = await response.text().catch(() => response.statusText);
            return {
                model,
                query_vector: null,
                document_vectors: new Array(documents.length).fill(null),
                dim: null,
                scores: null,
                prompt_tokens: null,
                total_tokens: null,
                elapsed_ms: Date.now() - startedAt,
                error: text.slice(0, 600),
            };
        }

        const json = (await response.json()) as UpstreamEmbeddingResponse;
        const aligned = alignVectors(json.data, totalInputs);
        const queryVec = aligned[0];
        const docVecs = aligned.slice(1);
        const dim = queryVec?.length ?? docVecs.find((v) => v?.length)?.length ?? null;

        const scores: PlaygroundEmbeddingDocScore[] | null = queryVec
            ? docVecs.map((v, i) => ({
                  index: i,
                  score: v ? cosine(queryVec, v) : 0,
              }))
            : null;

        return {
            model,
            query_vector: queryVec ?? null,
            document_vectors: docVecs,
            dim,
            scores,
            prompt_tokens: json.usage?.prompt_tokens ?? null,
            total_tokens: json.usage?.total_tokens ?? null,
            elapsed_ms: Date.now() - startedAt,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            model,
            query_vector: null,
            document_vectors: new Array(documents.length).fill(null),
            dim: null,
            scores: null,
            prompt_tokens: null,
            total_tokens: null,
            elapsed_ms: Date.now() - startedAt,
            error: message,
        };
    }
}

/** Embed `query` and every `document` line per model (one upstream
 *  call per model, fan-out across models) and return per-document
 *  cosine scores against the query.
 *
 *  Errors are captured per-model so a single broken model never hides
 *  the rest. Each call writes a normal `generation_logs` row via
 *  `forwardGeneration`. */
export async function runEmbeddingComparison(
    user: SessionUser,
    input: PlaygroundEmbeddingInput
): Promise<PlaygroundEmbeddingResult> {
    const params = buildParams(input);
    const results = await Promise.all(
        input.models.map((model) =>
            runOne(user, model, input.query, input.documents, params)
        )
    );
    return { query: input.query, documents: input.documents, results };
}
