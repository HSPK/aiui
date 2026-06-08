import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { forwardGeneration, resolveModel } from "../gateway";
import { forbidden } from "../response";
import type { SessionUser } from "../auth";
import type { PlaygroundChatInput } from "@/lib/schemas/playground";
import { extractText, type MessageContent } from "@/lib/schemas/content";

/**
 * Send a playground chat turn. Persists the user message + assistant
 * slot via upsert keyed on `assistant_message_id` — so a retry from
 * the inline error card replaces the same row instead of leaving an
 * orphaned sibling. Returns a streaming Response with `X-*` headers.
 */
export async function sendPlaygroundChat(user: SessionUser, body: PlaygroundChatInput): Promise<Response> {
    // Fail fast with a sensible 4xx if the model is bad before we touch the DB.
    await resolveModel(body.model);

    // Normalize the incoming content into a stable array form for
    // persistence — bare strings become a single text part, arrays stay
    // verbatim. The wire shape on the upstream call uses the same array
    // (chat-completions accepts it; the responses variant translates).
    const userContent: Array<{ type: string; [k: string]: unknown }> =
        typeof body.content === "string"
            ? [{ type: "text", text: body.content }]
            : (body.content as Array<{ type: string; [k: string]: unknown }>);
    const userText = extractText(body.content);

    const conversationId = body.conversation_id ?? randomUUID();
    const now = new Date().toISOString();

    const existingConv = db.select().from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId)).get();
    if (existingConv) {
        if (existingConv.userId !== user.id) throw forbidden();
        db.update(schema.conversations).set({ updatedAt: now })
            .where(eq(schema.conversations.id, conversationId)).run();
    } else {
        // Title from the user's text portion only — attachments don't
        // make for good titles.
        const titleText = (userText.trim() || "New Chat").slice(0, 40);
        db.insert(schema.conversations).values({
            id: conversationId,
            userId: user.id,
            title: titleText,
            config: { model: body.model },
            createdAt: now,
            updatedAt: now,
        }).run();
    }

    // Persist user message (idempotent on user_message_id).
    const userMessageId = body.user_message_id ?? randomUUID();
    const userExisting = db.select().from(schema.messages).where(eq(schema.messages.id, userMessageId)).get();
    if (!userExisting) {
        db.insert(schema.messages).values({
            id: userMessageId,
            conversationId,
            role: "user",
            content: userContent,
            parentId: body.parent_message_id ?? null,
            isActive: true,
            createdAt: now,
        }).run();
    }

    const limit = Math.max(1, body.history_limit ?? body.conv_histrory_limit ?? 20);
    const recent = db.select().from(schema.messages)
        .where(and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.isActive, true),
            // Skip errored assistant slots — they have empty content
            // and would poison the upstream prompt on subsequent turns.
            isNull(schema.messages.error),
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(limit)
        .all();
    recent.reverse();

    const messages: Array<{ role: string; content: MessageContent }> = [];
    if (body.system?.trim()) messages.push({ role: "system", content: body.system });
    for (const m of recent) {
        // Stored content is unknown — pass it through verbatim when it's
        // already in canonical shape; otherwise fall back to flattening.
        const c = m.content as MessageContent | unknown;
        if (typeof c === "string" || Array.isArray(c)) {
            messages.push({ role: m.role, content: c as MessageContent });
        } else {
            messages.push({ role: m.role, content: extractText(c as MessageContent) });
        }
    }

    const reqBody: Record<string, unknown> = {
        model: body.model,
        messages,
        stream: body.stream !== false,
    };
    for (const k of ["temperature", "max_tokens", "top_p", "frequency_penalty", "presence_penalty", "reasoning_effort"] as const) {
        const v = body[k];
        if (v !== undefined) reqBody[k] = v;
    }

    // Same id across attempts → retry replaces the row, no orphan sibling.
    const assistantMessageId = body.assistant_message_id ?? randomUUID();

    const upsertAssistant = (fields: {
        content: string;
        reasoning?: string | null;
        generationId?: string | null;
        error?: string | null;
    }) => {
        const tsNow = new Date().toISOString();
        const errorValue = fields.error ?? null;
        db.insert(schema.messages).values({
            id: assistantMessageId,
            conversationId,
            role: "assistant",
            content: [{ type: "text", text: fields.content }],
            reasoningContent: fields.reasoning || null,
            modelId: body.model,
            generationId: fields.generationId ?? null,
            parentId: userMessageId,
            isActive: true,
            error: errorValue,
            createdAt: tsNow,
        }).onConflictDoUpdate({
            target: schema.messages.id,
            set: {
                content: [{ type: "text", text: fields.content }],
                reasoningContent: fields.reasoning || null,
                modelId: body.model,
                generationId: fields.generationId ?? null,
                error: errorValue,
            },
        }).run();
        db.update(schema.conversations)
            .set({ updatedAt: tsNow })
            .where(eq(schema.conversations.id, conversationId))
            .run();
    };

    let logId: string | undefined;
    let response: Response;
    try {
        const result = await forwardGeneration(user, "chat", reqBody, {
            conversationId,
            messageId: assistantMessageId,
            onComplete: ({ content, reasoning }) => {
                upsertAssistant({
                    content,
                    reasoning,
                    generationId: logId ?? null,
                    error: null,
                });
            },
        });
        logId = result.logId;
        response = result.response;
    } catch (err) {
        // Thrown (network / resolveModel / empty-stream) — persist
        // as error slot and return structured response with the id.
        const message = err instanceof Error ? err.message : String(err);
        upsertAssistant({ content: "", error: message, generationId: null });
        return new Response(JSON.stringify({ code: 1, msg: message, data: null }), {
            status: 502,
            headers: {
                "Content-Type": "application/json",
                "X-Conversation-ID": conversationId,
                "X-Message-ID": assistantMessageId,
            },
        });
    }

    // Upstream returned non-stream error — persist slot, pass body through.
    if (!response.ok) {
        const text = await response.text();
        upsertAssistant({
            content: "",
            error: `HTTP ${response.status}: ${text.slice(0, 500)}`,
            generationId: logId ?? null,
        });
        const headers = new Headers(response.headers);
        headers.set("X-Message-ID", assistantMessageId);
        if (logId) headers.set("X-Generation-ID", logId);
        headers.set("X-Conversation-ID", conversationId);
        return new Response(text, { status: response.status, headers });
    }

    const headers = new Headers(response.headers);
    headers.set("X-Message-ID", assistantMessageId);
    if (logId) headers.set("X-Generation-ID", logId);
    headers.set("X-Conversation-ID", conversationId);
    return new Response(response.body, { status: response.status, headers });
}
