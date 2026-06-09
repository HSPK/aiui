import "server-only";
import { extractText, type ContentPart, type MessageContent } from "@/lib/schemas/content";

/**
 * Wire-format helpers for the playground tool-execution orchestrator.
 *
 * The orchestrator persists assistant turns as `ContentPart[]` (the
 * canonical shape — text + image + file + tool_call parts mixed in
 * one row), and tool results as separate `role: "tool"` messages.
 * Upstream chat-completion APIs expect a flatter shape:
 *   - assistant: `{role, content, tool_calls: [{id, type, function}]}`
 *   - tool:      `{role, content, tool_call_id}`
 *
 * `replayDbMessageToWire` translates a stored row into 0..N wire
 * messages. `pipeAndStripDone` is the inter-round SSE plumber — it
 * forwards a single round's stream while stripping the terminal
 * `[DONE]` so subsequent rounds can keep emitting on the same socket.
 *
 * Pure-functional, no I/O — kept in its own file so the orchestrator
 * in `service.ts` stays focused on the high-level loop.
 */

/** Wire message shape passed through to the gateway. `role: "tool"`
 *  carries the result of a function execution; the model uses it on
 *  the next round to compose a final answer. */
export interface WireMessage {
    role: string;
    content: MessageContent;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }>;
}

/**
 * Re-emit a stored message as one or more wire messages. Assistant
 * tool_call parts are folded into the assistant turn's `tool_calls`
 * envelope; tool_result parts become standalone `role: "tool"` turns.
 */
export function replayDbMessageToWire(role: string, content: unknown): WireMessage[] {
    if (typeof content === "string") {
        return [{ role, content }];
    }
    if (!Array.isArray(content)) {
        return [{ role, content: extractText(content as MessageContent) }];
    }
    const parts = content as ContentPart[];

    if (role === "tool") {
        const out: WireMessage[] = [];
        for (const p of parts) {
            if (p.type === "tool_result") {
                out.push({
                    role: "tool",
                    content: p.tool_result.content,
                    tool_call_id: p.tool_result.tool_call_id,
                });
            }
        }
        return out;
    }

    // Assistant or user (or system, etc.). Split user-visible content
    // from tool_call parts (assistant only).
    const visibleParts: ContentPart[] = [];
    const toolCalls: NonNullable<WireMessage["tool_calls"]> = [];
    for (const p of parts) {
        if (p.type === "tool_call") {
            toolCalls.push({
                id: p.tool_call.id,
                type: "function",
                function: { name: p.tool_call.name, arguments: p.tool_call.arguments },
            });
        } else if (p.type === "tool_result") {
            // Should only appear on role:"tool" but tolerate.
            continue;
        } else {
            visibleParts.push(p);
        }
    }
    if (visibleParts.length === 0 && toolCalls.length === 0) return [];

    const visibleContent: MessageContent = visibleParts.length === 0
        ? ""
        // Keep arrays verbatim — flattening a single-text-part array
        // back to a bare string would round-trip data lossy and
        // break clients that depend on the canonical wire shape.
        : visibleParts;

    const msg: WireMessage = { role, content: visibleContent };
    if (role === "assistant" && toolCalls.length > 0) msg.tool_calls = toolCalls;
    return [msg];
}

/**
 * Pipe one round's SSE stream to the client, stripping its `[DONE]`
 * terminator so the next round can keep emitting on the same socket.
 * Operates on line boundaries with carry-over buffering for chunks
 * that split mid-line.
 */
const PIPE_ENCODER = new TextEncoder();

export async function pipeAndStripDone(
    body: ReadableStream<Uint8Array>,
    controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            carry += decoder.decode(value, { stream: true });
            const lines = carry.split("\n");
            carry = lines.pop() ?? "";
            let out = "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") continue;
                out += line + "\n";
            }
            if (out) controller.enqueue(PIPE_ENCODER.encode(out));
        }
        if (carry) {
            const trimmed = carry.trim();
            if (trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]") {
                controller.enqueue(PIPE_ENCODER.encode(carry));
            }
        }
    } finally {
        // Free the upstream connection on any exit path (orderly
        // close, controller.enqueue throw on aborted client, etc.).
        // Without this, an aborted FE leaves the upstream socket
        // held until GC, which on free-tier rate-limited providers
        // can blow the per-key concurrency cap.
        try { await reader.cancel() } catch { /* ignore */ }
        try { reader.releaseLock() } catch { /* ignore */ }
    }
}
