import { bench, describe } from "vitest";
import { SSEParser } from "@/components/playground/chat/stream-parser";

// Runs in the browser for every network chunk of every streamed reply.
// A slow parser shows up directly as janky token rendering.

function chunkOf(n: number): string {
    let out = "";
    for (let i = 0; i < n; i++) {
        out += `data: ${JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: "tok " }, finish_reason: null }],
        })}\n\n`;
    }
    return out;
}

const ONE = chunkOf(1);
const BATCH = chunkOf(50);
const TOOL_CALLS = Array.from({ length: 20 }, (_, i) =>
    `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${i}`, function: { name: "search", arguments: '{"q":' } }] } }],
    })}\n\n`,
).join("");

describe("SSEParser", () => {
    bench("single content chunk", () => {
        new SSEParser().parse(ONE);
    });

    bench("50 content chunks in one network read", () => {
        new SSEParser().parse(BATCH);
    });

    bench("tool_call deltas", () => {
        new SSEParser().parse(TOOL_CALLS);
    });

    bench("split mid-record (buffer carry-over)", () => {
        const p = new SSEParser();
        p.parse(ONE.slice(0, 20));
        p.parse(ONE.slice(20));
    });
});
