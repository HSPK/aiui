import { bench, describe } from "vitest";
import { getVariant, type VariantContext } from "@/lib/server/api-variants";
import "@/lib/server/api-variants/register";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import type { Model, Provider } from "@/lib/server/db/schema";

// parseStreamChunk runs once PER TOKEN on every streamed response — the
// single hottest function in the server. Everything else in the request
// path is amortised over the whole response; this is not.

const chat = getVariant("chat.completions")!;
const responses = getVariant("responses")!;

const ctx: VariantContext = {
    provider: { id: "p1", name: "openai", baseUrl: "https://api.openai.com/v1" } as Provider,
    model: { id: "m1", name: "gpt-4o-mini", upstreamModelId: "gpt-4o-mini" } as Model,
    meta: { id: "gpt-4o-mini" } as never,
    capability: getCapability("chat")!,
    stream: true,
};

const contentChunk = {
    id: "chatcmpl-abc",
    model: "gpt-4o-mini",
    choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
};

const reasoningChunk = {
    id: "chatcmpl-abc",
    choices: [{ index: 0, delta: { reasoning_content: "thinking..." }, finish_reason: null }],
};

const toolChunk = {
    id: "chatcmpl-abc",
    choices: [{
        index: 0,
        delta: {
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } }],
        },
        finish_reason: null,
    }],
};

const usageChunk = {
    id: "chatcmpl-abc",
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
};

const finishChunk = {
    id: "chatcmpl-abc",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
};

const responsesDelta = { type: "response.output_text.delta", delta: "hello" };

describe("variant.parseStreamChunk (per-token)", () => {
    bench("chat.completions — content delta", () => {
        chat.parseStreamChunk(contentChunk, ctx);
    });

    bench("chat.completions — reasoning delta", () => {
        chat.parseStreamChunk(reasoningChunk, ctx);
    });

    bench("chat.completions — tool_call delta", () => {
        chat.parseStreamChunk(toolChunk, ctx);
    });

    bench("chat.completions — usage chunk", () => {
        chat.parseStreamChunk(usageChunk, ctx);
    });

    bench("chat.completions — finish chunk", () => {
        chat.parseStreamChunk(finishChunk, ctx);
    });

    bench("responses — output_text.delta", () => {
        responses.parseStreamChunk(responsesDelta, ctx);
    });
});

describe("SSE line framing (per network read)", () => {
    // Mirrors the buffer/split loop inside gateway/stream.ts so we can see
    // the cost of framing separately from the per-chunk JSON parse.
    const payload = Array.from({ length: 50 }, () => `data: ${JSON.stringify(contentChunk)}\n\n`).join("");

    bench("split + JSON.parse 50 events", () => {
        let buf = payload;
        const idx: unknown[] = [];
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const d = t.slice(5).trim();
            if (d === "[DONE]") continue;
            try { idx.push(JSON.parse(d)); } catch { /* ignore */ }
        }
    });
});
