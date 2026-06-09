import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { forwardGeneration, resolveModel, type AssembledToolCall } from "../gateway";
import { forbidden } from "../response";
import type { SessionUser } from "../auth";
import type { PlaygroundChatInput } from "@/lib/schemas/playground";
import {
    extractText,
    type ContentPart,
    type MessageContent,
    type ToolCallPart,
    type ToolResultPart,
} from "@/lib/schemas/content";
import { aggregateTools, executeTool, type AggregatedTool } from "../mcp/runtime";
import { pipeAndStripDone, replayDbMessageToWire, type WireMessage } from "./wire";

const MAX_TOOL_HOPS = 8;
// TextEncoder is stateless — share a single instance instead of
// instantiating per chat turn. Each request still allocates its own
// TextDecoder (decoder.decode keeps stream-mode state).
const SSE_ENCODER = new TextEncoder();

/**
 * Send a playground chat turn. Persists the user message + assistant
 * slot via upsert keyed on `assistant_message_id` — so a retry from
 * the inline error card replaces the same row instead of leaving an
 * orphaned sibling. Returns a streaming Response with `X-*` headers.
 *
 * When `enabled_mcp_server_ids` is non-empty, the service enters a
 * multi-hop tool execution loop: it aggregates tools from those MCP
 * servers, injects them into the upstream `tools[]`, and when the
 * model finishes a turn with `finish_reason="tool_calls"` it executes
 * each call via the MCP runtime, persists the assistant + tool result
 * messages, and re-issues the upstream call with the extended history.
 * The single response stream interleaves rounds: chat-completion SSE
 * chunks per round, plus synthetic `event: loom_tool_result` events so
 * the FE can render result bubbles in real time. The terminal `[DONE]`
 * fires only after the model produces a non-tool-call answer (or the
 * hop cap is reached).
 */
export async function sendPlaygroundChat(user: SessionUser, body: PlaygroundChatInput): Promise<Response> {
    // Fail fast with a sensible 4xx if the model is bad before we touch the DB.
    await resolveModel(body.model);

    const userContentArray: ContentPart[] =
        typeof body.content === "string"
            ? [{ type: "text", text: body.content }]
            : body.content;
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
        const titleText = (userText.trim() || "New Chat").slice(0, 40);
        // Race-safe insert: multi-model send (`streamMultiple` in
        // use-chat-stream) fires N parallel requests at the same
        // brand-new conversation_id. Without `onConflictDoNothing`
        // the second/third caller would crash with PK violation
        // because the SELECT above missed but their INSERT lost the
        // race. After the conflict-safe insert, re-select to apply
        // the standard ownership check.
        db.insert(schema.conversations).values({
            id: conversationId,
            userId: user.id,
            title: titleText,
            config: { model: body.model },
            createdAt: now,
            updatedAt: now,
        }).onConflictDoNothing().run();

        const after = db.select().from(schema.conversations)
            .where(eq(schema.conversations.id, conversationId)).get();
        if (!after) throw forbidden();
        if (after.userId !== user.id) throw forbidden();
    }

    // Persist user message (idempotent on user_message_id, race-safe
    // via onConflictDoNothing — multi-model `streamMultiple` fires N
    // parallel requests sharing the SAME user_message_id, and the
    // SELECT-then-INSERT pattern would crash N-1 of them on the PK).
    const userMessageId = body.user_message_id ?? randomUUID();
    db.insert(schema.messages).values({
        id: userMessageId,
        conversationId,
        role: "user",
        content: userContentArray,
        parentId: body.parent_message_id ?? null,
        isActive: true,
        createdAt: now,
    }).onConflictDoNothing().run();

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

    const wireMessages: WireMessage[] = [];
    if (body.system?.trim()) wireMessages.push({ role: "system", content: body.system });
    for (const m of recent) {
        const c = m.content as MessageContent | unknown;
        wireMessages.push(...replayDbMessageToWire(m.role, c));
    }

    const assistantMessageId = body.assistant_message_id ?? randomUUID();

    // Aggregate MCP tools (if any) for this turn. Failed servers are
    // surfaced to the client via synthetic SSE events but don't fail
    // the whole request.
    const enabledIds = body.enabled_mcp_server_ids ?? [];
    const { tools: aggregatedTools, errors: aggregateErrors } =
        enabledIds.length > 0
            ? await aggregateTools(enabledIds)
            : { tools: [] as AggregatedTool[], errors: [] };
    const toolIndex = new Map<string, AggregatedTool>();
    for (const t of aggregatedTools) toolIndex.set(t.qualifiedName, t);

    const baseBody: Record<string, unknown> = {
        model: body.model,
        stream: body.stream !== false,
    };
    for (const k of ["temperature", "max_tokens", "top_p", "frequency_penalty", "presence_penalty", "reasoning_effort"] as const) {
        const v = body[k];
        if (v !== undefined) baseBody[k] = v;
    }
    if (aggregatedTools.length > 0) {
        baseBody.tools = aggregatedTools.map((t) => ({
            type: "function" as const,
            function: {
                name: t.qualifiedName,
                description: t.description,
                parameters: t.parameters,
            },
        }));
    }

    // ---- assistant slot persistence ----

    const accumParts: ContentPart[] = [];
    let lastReasoning = "";
    let lastError: string | null = null;
    let lastGenerationId: string | null = null;

    const upsertAssistant = () => {
        const tsNow = new Date().toISOString();
        const contentForRow: ContentPart[] = accumParts.length > 0
            ? accumParts
            : [{ type: "text", text: "" }];
        db.insert(schema.messages).values({
            id: assistantMessageId,
            conversationId,
            role: "assistant",
            content: contentForRow,
            reasoningContent: lastReasoning || null,
            modelId: body.model,
            generationId: lastGenerationId,
            parentId: userMessageId,
            isActive: true,
            error: lastError,
            createdAt: tsNow,
        }).onConflictDoUpdate({
            target: schema.messages.id,
            set: {
                content: contentForRow,
                reasoningContent: lastReasoning || null,
                modelId: body.model,
                generationId: lastGenerationId,
                error: lastError,
            },
        }).run();
        // NOTE: deliberately NOT bumping conversations.updatedAt here.
        // It was already bumped at turn-start (the sidebar-sort key
        // is "you sent something on this conv"). Repeating per tool
        // round writes the same row N times for nothing.
    };

    const insertToolMessage = (part: ToolResultPart, parentId: string) => {
        const tsNow = new Date().toISOString();
        db.insert(schema.messages).values({
            id: randomUUID(),
            conversationId,
            role: "tool",
            content: [part],
            parentId,
            isActive: true,
            createdAt: tsNow,
        }).run();
    };

    // ---- response stream ----

    // Client-disconnect signal. The ReadableStream's `cancel()` fires
    // when the consumer goes away (browser closed the tab, FE
    // AbortController.abort(), proxy hangup, ...). We propagate that
    // via an AbortController so the orchestrator can:
    //   1. Tear down the in-flight upstream HTTP request (saves $$).
    //   2. Bail out of the multi-hop tool loop instead of running
    //      executeTool + dispatching MCP calls into a closed stream.
    const abortController = new AbortController();

    const responseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (chunk: Uint8Array) => controller.enqueue(chunk);
            const emitEvent = (event: string, data: unknown) => {
                send(SSE_ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };

            // Surface any tool-aggregation errors up front so the FE can
            // toast them before the model starts responding.
            for (const err of aggregateErrors) {
                emitEvent("loom_tool_error", {
                    server_id: err.serverId,
                    server_name: err.serverName,
                    message: err.message,
                });
            }

            try {
                let hops = 0;
                let pendingToolCalls: AssembledToolCall[] | undefined;
                let pendingFinishReason: string | undefined;

                while (true) {
                    if (abortController.signal.aborted) break;
                    if (hops >= MAX_TOOL_HOPS) {
                        emitEvent("loom_tool_error", {
                            message: `Max tool hops (${MAX_TOOL_HOPS}) reached without final answer`,
                        });
                        break;
                    }

                    const reqBody = { ...baseBody, messages: wireMessages };

                    let roundContent = "";
                    let roundReasoning = "";
                    let roundFinish: string | undefined;
                    let roundToolCalls: AssembledToolCall[] | undefined;
                    let result;
                    try {
                        result = await forwardGeneration(user, "chat", reqBody, {
                            conversationId,
                            messageId: assistantMessageId,
                            signal: abortController.signal,
                            onComplete: ({ content, reasoning, toolCalls, finishReason }) => {
                                roundContent = content;
                                roundReasoning = reasoning;
                                roundToolCalls = toolCalls;
                                roundFinish = finishReason;
                            },
                        });
                    } catch (err) {
                        // Client-disconnect aborts the upstream fetch
                        // and shows up here as AbortError — that's not
                        // a "loom_error", just stop quietly.
                        if (abortController.signal.aborted) break;
                        const message = err instanceof Error ? err.message : String(err);
                        lastError = message;
                        upsertAssistant();
                        emitEvent("loom_error", { message });
                        break;
                    }

                    if (abortController.signal.aborted) break;

                    lastGenerationId = result.logId;
                    // Surface the per-round message + generation id over
                    // SSE — response headers were emitted before any
                    // forwardGeneration call, so this is the only path
                    // to tell the FE which row + log to wire actions to.
                    emitEvent("loom_message_meta", {
                        message_id: assistantMessageId,
                        generation_id: result.logId,
                    });

                    // The gateway already opened the upstream connection
                    // and is streaming chat-completion-shaped SSE. Strip
                    // its terminal [DONE] tokens so the client sees one
                    // continuous stream across rounds.
                    if (!result.response.ok) {
                        const text = await result.response.text().catch(() => "");
                        lastError = `HTTP ${result.response.status}: ${text.slice(0, 500)}`;
                        upsertAssistant();
                        emitEvent("loom_error", { message: lastError });
                        break;
                    }
                    if (!result.response.body) {
                        lastError = "Upstream returned empty stream";
                        upsertAssistant();
                        emitEvent("loom_error", { message: lastError });
                        break;
                    }

                    await pipeAndStripDone(result.response.body, controller);

                    // Round complete — merge into accumulators.
                    if (roundContent) {
                        accumParts.push({ type: "text", text: roundContent });
                    }
                    if (roundReasoning) {
                        // Reasoning is overwritten with the latest round
                        // (final round answer matters most).
                        lastReasoning = roundReasoning;
                    }

                    pendingToolCalls = roundToolCalls;
                    pendingFinishReason = roundFinish;

                    const wantsTools = pendingFinishReason === "tool_calls"
                        && pendingToolCalls && pendingToolCalls.length > 0;
                    if (!wantsTools) {
                        // Final answer — persist + terminate.
                        upsertAssistant();
                        break;
                    }

                    // Annotate the assistant message with the tool_call
                    // parts the model just emitted so the FE shows the
                    // bubbles on a fresh page-load too.
                    for (const tc of pendingToolCalls!) {
                        const envelope = toolIndex.get(tc.name);
                        const callPart: ToolCallPart = {
                            type: "tool_call",
                            tool_call: {
                                id: tc.id,
                                name: tc.name,
                                arguments: tc.arguments,
                                source: envelope?.serverName,
                            },
                        };
                        accumParts.push(callPart);
                    }
                    upsertAssistant();

                    // Build the assistant tool_calls envelope for the
                    // next round's history. Without this, the model
                    // doesn't know which calls produced which results.
                    wireMessages.push({
                        role: "assistant",
                        content: roundContent,
                        tool_calls: pendingToolCalls!.map((tc) => ({
                            id: tc.id,
                            type: "function",
                            function: { name: tc.name, arguments: tc.arguments },
                        })),
                    });

                    // Execute each tool call. Failures become tool
                    // result messages with `is_error: true` so the model
                    // can see them and recover.
                    //
                    // Parallelise: a single model turn that emits
                    // `[weather(LA), weather(NYC), weather(SF)]` was
                    // waiting for each tool sequentially before. The
                    // tools themselves are independent — only the
                    // history shape matters, and we restore that by
                    // walking the resolved Promises in original order.
                    if (abortController.signal.aborted) break;
                    const execs = await Promise.all(
                        pendingToolCalls!.map(async (tc) => {
                            const envelope = toolIndex.get(tc.name);
                            if (!envelope) {
                                return {
                                    content: `No MCP server has a tool called "${tc.name}". Available: ${Array.from(toolIndex.keys()).join(", ") || "<none>"}.`,
                                    isError: true,
                                    serverName: "unknown",
                                };
                            }
                            return executeTool(tc.name, tc.arguments);
                        }),
                    );

                    for (let i = 0; i < pendingToolCalls!.length; i++) {
                        const tc = pendingToolCalls![i];
                        const exec = execs[i];

                        const resultPart: ToolResultPart = {
                            type: "tool_result",
                            tool_result: {
                                tool_call_id: tc.id,
                                name: tc.name,
                                content: exec.content,
                                is_error: exec.isError,
                                source: exec.serverName,
                            },
                        };
                        insertToolMessage(resultPart, assistantMessageId);

                        // Surface to the FE as a synthetic event — the
                        // chat input doesn't poll messages mid-turn so
                        // this is how the bubble appears in real time.
                        emitEvent("loom_tool_result", {
                            call_id: tc.id,
                            name: tc.name,
                            content: exec.content,
                            is_error: exec.isError,
                            source: exec.serverName,
                        });

                        wireMessages.push({
                            role: "tool",
                            content: exec.content,
                            tool_call_id: tc.id,
                        });
                    }

                    hops += 1;
                }
            } finally {
                // One terminal [DONE] for the whole multi-round stream.
                // controller.enqueue / .close throw if the stream was
                // already cancelled (client disconnect); swallow those
                // so we don't crash the producer mid-cleanup.
                try { send(SSE_ENCODER.encode("data: [DONE]\n\n")); } catch { /* stream closed */ }
                try { controller.close(); } catch { /* stream closed */ }
            }
        },
        cancel() {
            // Consumer (FE / proxy) gave up. Trip the abort signal so
            // the orchestrator's main loop bails out of the next round
            // and the in-flight upstream fetch is torn down.
            abortController.abort();
        },
    });

    return new Response(responseStream, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Conversation-ID": conversationId,
            "X-Message-ID": assistantMessageId,
        },
    });
}

