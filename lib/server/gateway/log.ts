import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

/**
 * Generation-log writers. Two-phase by design — `startLog` returns a
 * row id before the upstream call begins so the response stream can
 * carry `X-Generation-ID` immediately; `completeLog` patches the
 * outcome (tokens / latency / merged response body) once the call
 * settles. Stays a private internal of the gateway module so the
 * `generationLogs` table column shape can evolve without touching
 * variant or adapter code.
 */

export interface GatewayLogPayload {
    userId: string;
    modelName: string;
    capability: string;
    requestBody: Record<string, unknown>;
    inputSummary: string | null;
    conversationId?: string;
    messageId?: string;
}

// Fields that represent INPUT DATA (not sampling kwargs). Stripped
// from `generation_kwargs` so the kwargs column only carries model
// + sampling params + tool config — not megabytes of messages /
// images / audio / files / embeddings input. The full body is still
// persisted under `input` for the "Conversation" / "Input" accordion.
const INPUT_DATA_KEYS = new Set([
    "messages",      // chat.completions
    "input",         // embeddings, audio.speech, responses
    "image",         // image edits
    "mask",          // image edits
    "file",          // audio.transcription multipart
    "prompt",        // image generation, video, audio.transcription
    "tools",         // chat tool catalog (can be large)
]);

function extractKwargs(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
        if (INPUT_DATA_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out;
}

// Lossy compression of base64 blobs inside the request body before it
// hits the DB. Multimodal chats can carry MB-sized data URLs (image,
// audio, file attachments); persisting them verbatim into the `input`
// JSON column would bloat the DB and crash the log JSON viewer.
// FE display already replaces them with short placeholders, so storing
// the full blob serves no use case — we can't "replay" a request from
// the FE either.
//
// Threshold is generous (2 KB) so legitimate short b64 (e.g. an icon)
// is preserved. Anything bigger collapses to a `[base64 ..., ~NN KB]`
// marker carrying the same shape as the FE display sanitizer for a
// uniform viewer experience.
const B64_INLINE_THRESHOLD = 2048;
const BARE_B64_HEAD_PROBE = /^[A-Za-z0-9+/=]+$/;

function sanitizeStringForLog(s: string): string {
    if (s.length <= B64_INLINE_THRESHOLD) return s;
    if (s.startsWith("data:")) {
        const semi = s.indexOf(";");
        const mime = semi > 5 ? s.slice(5, semi) : "binary";
        const kb = Math.round(s.length / 1024);
        const kind = mime.startsWith("image/") ? "image" : "file";
        return `[base64 ${kind} ${mime}, ~${kb} KB]`;
    }
    if (BARE_B64_HEAD_PROBE.test(s.slice(0, 96))) {
        const kb = Math.round(s.length / 1024);
        return `[base64 blob, ~${kb} KB]`;
    }
    return s;
}

function sanitizeBodyForLog(value: unknown): unknown {
    if (typeof value === "string") return sanitizeStringForLog(value);
    if (Array.isArray(value)) return value.map(sanitizeBodyForLog);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = sanitizeBodyForLog(v);
        }
        return out;
    }
    return value;
}

export function startLog(payload: GatewayLogPayload): string {
    const id = randomUUID();
    const sanitizedInput = sanitizeBodyForLog(payload.requestBody) as Record<string, unknown>;
    db.insert(schema.generationLogs).values({
        id,
        userId: payload.userId,
        modelName: payload.modelName,
        capability: payload.capability,
        status: "pending",
        input: sanitizedInput,
        inputSummary: payload.inputSummary,
        generationKwargs: extractKwargs(sanitizedInput),
        conversationId: payload.conversationId ?? null,
        messageId: payload.messageId ?? null,
    }).run();
    return id;
}

export interface GatewayLogCompletion {
    status: "completed" | "failed";
    output?: string | null;
    reason?: string | null;
    generation?: Record<string, unknown> | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    firstTokenLatencyMs?: number | null;
    totalLatencyMs?: number;
}

export function completeLog(id: string, fields: GatewayLogCompletion): void {
    db.update(schema.generationLogs).set({
        status: fields.status,
        output: fields.output ?? null,
        reason: fields.reason ?? null,
        generation: fields.generation ?? null,
        promptTokens: fields.promptTokens ?? null,
        completionTokens: fields.completionTokens ?? null,
        totalTokens: fields.totalTokens ?? null,
        firstTokenLatencyMs: fields.firstTokenLatencyMs ?? null,
        totalLatencyMs: fields.totalLatencyMs ?? null,
        updatedAt: new Date().toISOString(),
    }).where(eq(schema.generationLogs.id, id)).run();
}
