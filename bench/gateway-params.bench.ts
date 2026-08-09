import { bench, describe } from "vitest";
import { mergeParams } from "@/lib/server/gateway";
import { applyFieldFilter } from "@/lib/server/adapters/openai";
import type { Model, Provider } from "@/lib/server/db/schema";

// mergeParams + applyFieldFilter run once per gateway request, before any
// network I/O. They walk the whole request body, so cost scales with how
// chatty the caller is.

const provider = {
    defaultParams: { temperature: 0.7, stream_options: { include_usage: true } },
} as unknown as Provider;

const model = {
    defaultParams: { max_tokens: 4096, reasoning: { effort: "medium" } },
} as unknown as Model;

const smallBody: Record<string, unknown> = {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
};

const chattyBody: Record<string, unknown> = {
    model: "gpt-4o-mini",
    messages: Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn ${i} `.repeat(20),
    })),
    stream: true,
    stream_options: { include_obfuscation: false },
    temperature: 0.2,
    top_p: 0.9,
    presence_penalty: 0.1,
    frequency_penalty: 0.1,
    response_format: { type: "json_object" },
    reasoning: { summary: "auto" },
    tools: Array.from({ length: 12 }, (_, i) => ({
        type: "function",
        function: { name: `tool_${i}`, parameters: { type: "object", properties: {} } },
    })),
};

const permissiveMeta = { id: "gpt-4o-mini" } as never;
const strictMeta = {
    id: "grok-3",
    rejectFields: ["stream_options", "parallel_tool_calls", "presence_penalty", "frequency_penalty"],
} as never;

describe("gateway request pipeline", () => {
    bench("mergeParams — small body", () => {
        mergeParams(smallBody, model, provider);
    });

    bench("mergeParams — 40-turn body with tools", () => {
        mergeParams(chattyBody, model, provider);
    });

    bench("applyFieldFilter — permissive meta", () => {
        applyFieldFilter(chattyBody, permissiveMeta);
    });

    bench("applyFieldFilter — reject list", () => {
        applyFieldFilter(chattyBody, strictMeta);
    });

    bench("mergeParams + applyFieldFilter (full per-request prelude)", () => {
        applyFieldFilter(mergeParams(chattyBody, model, provider), strictMeta);
    });
});
