import "server-only";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { forwardChatCompletions, resolveModel } from "@/lib/server/gateway";
import { fail, handle } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlaygroundBody {
    message: string;
    conversation_id?: string;
    parent_message_id?: string | null;
    user_message_id?: string;
    model?: string;
    system?: string;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    reasoning_effort?: "low" | "medium" | "high";
    conv_histrory_limit?: number;
    history_limit?: number;
    stream?: boolean;
}

function asContentText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? ""))
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        const user = await requireUser();
        const body = (await req.json()) as PlaygroundBody;

        const userMessageText = body.message ?? "";
        if (!userMessageText.trim()) return fail("`message` is required", 400);
        if (!body.model) return fail("`model` is required", 400);

        // Resolve model early so we fail fast with a sensible 4xx.
        await resolveModel(body.model);

        const conversationId = body.conversation_id ?? randomUUID();
        const now = new Date().toISOString();

        // Upsert conversation
        const existingConv = db.select().from(schema.conversations)
            .where(eq(schema.conversations.id, conversationId)).get();
        if (!existingConv) {
            db.insert(schema.conversations).values({
                id: conversationId,
                userId: user.id,
                title: userMessageText.slice(0, 40) || "New Chat",
                config: { model: body.model },
                createdAt: now,
                updatedAt: now,
            }).run();
        } else {
            if (existingConv.userId !== user.id) return fail("Forbidden", 403);
            db.update(schema.conversations).set({ updatedAt: now })
                .where(eq(schema.conversations.id, conversationId)).run();
        }

        // Persist user message
        const userMessageId = body.user_message_id ?? randomUUID();
        const userExisting = db.select().from(schema.messages).where(eq(schema.messages.id, userMessageId)).get();
        if (!userExisting) {
            db.insert(schema.messages).values({
                id: userMessageId,
                conversationId,
                role: "user",
                content: [{ type: "text", text: userMessageText }],
                parentId: body.parent_message_id ?? null,
                isActive: true,
                createdAt: now,
            }).run();
        }

        // Build chat history
        const limit = Math.max(1, body.conv_histrory_limit ?? body.history_limit ?? 20);
        const recent = db.select().from(schema.messages)
            .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.isActive, true)))
            .orderBy(desc(schema.messages.createdAt))
            .limit(limit)
            .all();
        recent.reverse();

        const messages: Array<{ role: string; content: string }> = [];
        if (body.system && body.system.trim()) {
            messages.push({ role: "system", content: body.system });
        }
        for (const m of recent) {
            messages.push({ role: m.role, content: asContentText(m.content) });
        }

        const reqBody: Record<string, unknown> = {
            model: body.model,
            messages,
            stream: body.stream !== false,
        };
        if (body.temperature !== undefined) reqBody.temperature = body.temperature;
        if (body.max_tokens !== undefined) reqBody.max_tokens = body.max_tokens;
        if (body.top_p !== undefined) reqBody.top_p = body.top_p;
        if (body.frequency_penalty !== undefined) reqBody.frequency_penalty = body.frequency_penalty;
        if (body.presence_penalty !== undefined) reqBody.presence_penalty = body.presence_penalty;
        if (body.reasoning_effort !== undefined) reqBody.reasoning_effort = body.reasoning_effort;

        const assistantMessageId = randomUUID();

        const { response, logId } = await forwardChatCompletions(user, reqBody, {
            conversationId,
            messageId: assistantMessageId,
            onComplete: ({ content, reasoning }) => {
                db.insert(schema.messages).values({
                    id: assistantMessageId,
                    conversationId,
                    role: "assistant",
                    content: [{ type: "text", text: content }],
                    reasoningContent: reasoning || null,
                    modelId: body.model ?? null,
                    generationId: logId,
                    parentId: userMessageId,
                    isActive: true,
                    createdAt: new Date().toISOString(),
                }).run();
                db.update(schema.conversations)
                    .set({ updatedAt: new Date().toISOString() })
                    .where(eq(schema.conversations.id, conversationId))
                    .run();
            },
        });

        const headers = new Headers(response.headers);
        headers.set("X-Message-ID", assistantMessageId);
        headers.set("X-Generation-ID", logId);
        headers.set("X-Conversation-ID", conversationId);
        return new Response(response.body, { status: response.status, headers });
    } catch (err) {
        return handle(err);
    }
}

