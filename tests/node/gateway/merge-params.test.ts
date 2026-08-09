// Pure-function tests for `mergeParams` — no DB/network involved.
// `mergeParams` only ever reads `.defaultParams` off the model/provider
// rows it's given, so we hand-build minimal fakes rather than seeding
// real DB rows (keeps this suite fast and DB-independent).
import { describe, expect, it } from "vitest";
import { mergeParams } from "@/lib/server/gateway";
import type { Model, Provider } from "@/lib/server/db/schema";

function fakeProvider(defaultParams: Record<string, unknown> | null): Provider {
    return { defaultParams } as unknown as Provider;
}

function fakeModel(defaultParams: Record<string, unknown> | null): Model {
    return { defaultParams } as unknown as Model;
}

describe("mergeParams", () => {
    it("caller body wins over model defaults, which win over provider defaults", () => {
        const provider = fakeProvider({ a: 1, b: 2 });
        const model = fakeModel({ b: 3, c: 4 });
        const body = { c: 5, d: 6 };
        expect(mergeParams(body, model, provider)).toEqual({ a: 1, b: 3, c: 5, d: 6 });
    });

    it("plain top-level keys are last-write-wins (no deep merge outside the whitelist)", () => {
        const provider = fakeProvider({ max_tokens: 100 });
        const model = fakeModel({ max_tokens: 200 });
        expect(mergeParams({}, model, provider).max_tokens).toBe(200);
        expect(mergeParams({ max_tokens: 50 }, model, provider).max_tokens).toBe(50);
    });

    it("passes an untouched body straight through when neither provider nor model set defaults", () => {
        const provider = fakeProvider({});
        const model = fakeModel({});
        const body = { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] };
        expect(mergeParams(body, model, provider)).toEqual(body);
    });

    it("treats null defaultParams (provider/model) as an empty object", () => {
        const provider = fakeProvider(null);
        const model = fakeModel(null);
        expect(mergeParams({ x: 1 }, model, provider)).toEqual({ x: 1 });
    });

    describe("nested nested-merge keys (stream_options / reasoning / response_format)", () => {
        it("deep-merges provider + model + caller stream_options, caller wins per-field", () => {
            const provider = fakeProvider({ stream_options: { include_usage: true, extra: "p" } });
            const model = fakeModel({ stream_options: { include_usage: false, extra2: "m" } });
            const body = { stream_options: { include_usage: false } };
            const merged = mergeParams(body, model, provider);
            // caller's include_usage(false) wins over model's(false)/provider's(true) —
            // but keys the caller never touched (extra, extra2) survive from the
            // admin layers underneath.
            expect(merged.stream_options).toEqual({ include_usage: false, extra: "p", extra2: "m" });
        });

        it("deep-merges provider + model even when the caller never mentions the key", () => {
            const provider = fakeProvider({ stream_options: { include_usage: true, extra: "p" } });
            const model = fakeModel({ stream_options: { include_usage: false } });
            const merged = mergeParams({}, model, provider);
            expect(merged.stream_options).toEqual({ include_usage: false, extra: "p" });
        });

        it("merges reasoning the same way as stream_options", () => {
            const provider = fakeProvider({ reasoning: { effort: "low", extra: "p" } });
            const model = fakeModel({ reasoning: { effort: "medium" } });
            const merged = mergeParams({ reasoning: { effort: "high" } }, model, provider);
            expect(merged.reasoning).toEqual({ effort: "high", extra: "p" });
        });

        it("merges response_format the same way", () => {
            const provider = fakeProvider({ response_format: { type: "text" } });
            const model = fakeModel({});
            const merged = mergeParams({ response_format: { type: "json_object" } }, model, provider);
            expect(merged.response_format).toEqual({ type: "json_object" });
        });

        it("a caller explicitly passing null suppresses admin defaults instead of merging under them", () => {
            const provider = fakeProvider({ stream_options: { include_usage: true } });
            const model = fakeModel({ stream_options: { include_usage: true } });
            const merged = mergeParams({ stream_options: null }, model, provider);
            // Deliberate suppression — caller always wins, so this must
            // stay exactly null, NOT get re-merged into an object.
            expect(merged.stream_options).toBeNull();
        });

        it("a caller explicitly passing false suppresses admin defaults", () => {
            const provider = fakeProvider({ reasoning: { effort: "low" } });
            const model = fakeModel({});
            const merged = mergeParams({ reasoning: false }, model, provider);
            expect(merged.reasoning).toBe(false);
        });

        it("a caller explicitly passing a non-object, non-null primitive (string) also suppresses", () => {
            const provider = fakeProvider({ response_format: { type: "text" } });
            const model = fakeModel({});
            const merged = mergeParams({ response_format: "text" }, model, provider);
            expect(merged.response_format).toBe("text");
        });

        it("a caller explicitly passing an array at a nested-merge key is treated as non-object (suppresses)", () => {
            // Arrays are `typeof === "object"` but isPlainObject() explicitly
            // excludes them — verifies the Array.isArray() guard branch.
            const provider = fakeProvider({ stream_options: { include_usage: true } });
            const model = fakeModel({});
            const merged = mergeParams({ stream_options: [1, 2] }, model, provider);
            expect(merged.stream_options).toEqual([1, 2]);
        });

        it("single admin layer (only provider) with no caller value: keeps that layer as-is (no length>1 branch)", () => {
            const provider = fakeProvider({ stream_options: { include_usage: true } });
            const model = fakeModel({});
            const merged = mergeParams({}, model, provider);
            expect(merged.stream_options).toEqual({ include_usage: true });
        });

        it("no admin defaults at all, caller supplies the object: single layer, passes through unmerged", () => {
            const provider = fakeProvider({});
            const model = fakeModel({});
            const merged = mergeParams({ stream_options: { include_usage: true } }, model, provider);
            expect(merged.stream_options).toEqual({ include_usage: true });
        });
    });
});
