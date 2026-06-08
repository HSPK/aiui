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

export interface GatewayLogCompletion {
    status: "completed" | "failed";
    output?: string | null;
    reason?: string | null;
    content?: unknown;
    generation?: Record<string, unknown> | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    firstTokenLatencyMs?: number | null;
    totalLatencyMs?: number;
}

export function startLog(payload: GatewayLogPayload): string {
    const id = randomUUID();
    db.insert(schema.generationLogs).values({
        id,
        userId: payload.userId,
        modelName: payload.modelName,
        capability: payload.capability,
        status: "pending",
        input: payload.requestBody,
        inputSummary: payload.inputSummary,
        generationKwargs: payload.requestBody,
        conversationId: payload.conversationId ?? null,
        messageId: payload.messageId ?? null,
    }).run();
    return id;
}

export function completeLog(id: string, fields: GatewayLogCompletion): void {
    db.update(schema.generationLogs).set({
        status: fields.status,
        output: fields.output ?? null,
        reason: fields.reason ?? null,
        content: fields.content ?? null,
        generation: fields.generation ?? null,
        promptTokens: fields.promptTokens ?? null,
        completionTokens: fields.completionTokens ?? null,
        totalTokens: fields.totalTokens ?? null,
        firstTokenLatencyMs: fields.firstTokenLatencyMs ?? null,
        totalLatencyMs: fields.totalLatencyMs ?? null,
        updatedAt: new Date().toISOString(),
    }).where(eq(schema.generationLogs.id, id)).run();
}
