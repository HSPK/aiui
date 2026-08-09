import { describe, expect, it } from "vitest";
import {
    defaultSelectVariantId,
    extractUpstreamError,
    getVariant,
    listVariants,
    registerVariant,
    variantsForCapability,
    type UpstreamApiVariant,
} from "@/lib/server/api-variants";
import type { CapabilityHandler } from "@/lib/server/capabilities";
import type { NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";

/**
 * This file never imports `@/lib/server/api-variants/register`, so the
 * registry starts empty and only ever contains the fake, uniquely-named
 * variants each test registers below — no risk of clobbering the real
 * built-in variants (which are exercised by the per-variant test files).
 */
function variantId(s: string): UpstreamApiId {
    return s as UpstreamApiId;
}

function fakeVariant(id: UpstreamApiId, capability: string): UpstreamApiVariant {
    return {
        id,
        capability,
        path: `/${id}`,
        supportsStreaming: false,
        parseResponse: () => ({ output: null, promptTokens: null, completionTokens: null, totalTokens: null, normalized: {} }),
        parseStreamChunk: () => null,
    };
}

describe("api-variants/index — registerVariant / getVariant / variantsForCapability / listVariants", () => {
    it("registers a variant and makes it retrievable by id and by capability", () => {
        const id = variantId("reg-basic-1");
        const v = fakeVariant(id, "reg-cap-basic");
        registerVariant(v);
        expect(getVariant(id)).toBe(v);
        expect(variantsForCapability("reg-cap-basic")).toEqual([v]);
        expect(listVariants()).toEqual(expect.arrayContaining([v]));
    });

    it("variantsForCapability returns [] for a capability with nothing registered", () => {
        expect(variantsForCapability("no-such-capability-xyz")).toEqual([]);
    });

    it("replaces in place within the SAME capability bucket when re-registered with an unchanged capability", () => {
        const id = variantId("reg-same-cap-1");
        const v1 = fakeVariant(id, "reg-cap-same");
        registerVariant(v1);
        const v2 = fakeVariant(id, "reg-cap-same");
        registerVariant(v2);
        const bucket = variantsForCapability("reg-cap-same");
        expect(bucket).toHaveLength(1);
        expect(bucket[0]).toBe(v2);
        expect(getVariant(id)).toBe(v2);
    });

    it("moves the variant to its NEW capability bucket when re-registered under a different capability", () => {
        const id = variantId("reg-move-1");
        const v1 = fakeVariant(id, "reg-cap-move-from");
        registerVariant(v1);
        expect(variantsForCapability("reg-cap-move-from").map((v) => v.id)).toContain(id);

        const v2 = fakeVariant(id, "reg-cap-move-to");
        registerVariant(v2);
        expect(variantsForCapability("reg-cap-move-from").map((v) => v.id)).not.toContain(id);
        expect(variantsForCapability("reg-cap-move-to").map((v) => v.id)).toContain(id);
        expect(getVariant(id)).toBe(v2);
    });
});

describe("api-variants/index — defaultSelectVariantId", () => {
    it("walks capability.variantPreference top-down, picking the first one supported by the model", () => {
        const idA = variantId("dsv-pref-a");
        const idB = variantId("dsv-pref-b");
        registerVariant(fakeVariant(idA, "dsv-cap-pref"));
        registerVariant(fakeVariant(idB, "dsv-cap-pref"));
        const capability: CapabilityHandler = { id: "dsv-cap-pref", label: "x", defaultVariantId: idB, variantPreference: [idA, idB] };

        // Both supported: preference order wins (A before B).
        const metaBoth: NormalizedModelMeta = { upstream_id: "m", supported_apis: [idB, idA], capabilities: {} };
        expect(defaultSelectVariantId(capability, metaBoth)).toBe(idA);

        // Only B supported: A is preferred-but-unsupported, so B is picked.
        const metaOnlyB: NormalizedModelMeta = { upstream_id: "m", supported_apis: [idB], capabilities: {} };
        expect(defaultSelectVariantId(capability, metaOnlyB)).toBe(idB);
    });

    it("falls through to ANY registered variant for the capability that appears in meta.supported_apis when there's no variantPreference match", () => {
        const idA = variantId("dsv-cand-a");
        const idB = variantId("dsv-cand-b");
        registerVariant(fakeVariant(idA, "dsv-cap-cand"));
        registerVariant(fakeVariant(idB, "dsv-cap-cand"));
        // No variantPreference at all on the capability.
        const capability: CapabilityHandler = { id: "dsv-cap-cand", label: "x", defaultVariantId: idA };
        const meta: NormalizedModelMeta = { upstream_id: "m", supported_apis: [idB], capabilities: {} };
        expect(defaultSelectVariantId(capability, meta)).toBe(idB);
    });

    it("falls through past an unsupported variantPreference entry to the candidates loop", () => {
        const idA = variantId("dsv-pref-unsup-a");
        const idB = variantId("dsv-pref-unsup-b");
        registerVariant(fakeVariant(idA, "dsv-cap-unsup"));
        registerVariant(fakeVariant(idB, "dsv-cap-unsup"));
        const capability: CapabilityHandler = { id: "dsv-cap-unsup", label: "x", defaultVariantId: idA, variantPreference: [idA] };
        // meta only supports B — idA (the only preference) never matches supported_apis,
        // so the loop over `candidates` (registration order) must find B.
        const meta: NormalizedModelMeta = { upstream_id: "m", supported_apis: [idB], capabilities: {} };
        expect(defaultSelectVariantId(capability, meta)).toBe(idB);
    });

    it("falls back to capability.defaultVariantId when nothing in supported_apis matches any candidate", () => {
        const idA = variantId("dsv-default-a");
        registerVariant(fakeVariant(idA, "dsv-cap-default"));
        const capability: CapabilityHandler = { id: "dsv-cap-default", label: "x", defaultVariantId: idA };
        const meta: NormalizedModelMeta = { upstream_id: "m", supported_apis: [], capabilities: {} };
        expect(defaultSelectVariantId(capability, meta)).toBe(idA);
    });

    it("falls back to defaultVariantId even with meta === null", () => {
        const idA = variantId("dsv-null-meta-a");
        registerVariant(fakeVariant(idA, "dsv-cap-null-meta"));
        const capability: CapabilityHandler = { id: "dsv-cap-null-meta", label: "x", defaultVariantId: idA };
        expect(defaultSelectVariantId(capability, null)).toBe(idA);
    });

    it("falls back to the first registered candidate when defaultVariantId is absent or unregistered", () => {
        const idA = variantId("dsv-first-a");
        const idB = variantId("dsv-first-b");
        registerVariant(fakeVariant(idA, "dsv-cap-first"));
        registerVariant(fakeVariant(idB, "dsv-cap-first"));
        const capability: CapabilityHandler = { id: "dsv-cap-first", label: "x", defaultVariantId: variantId("dsv-unregistered") };
        expect(defaultSelectVariantId(capability, null)).toBe(idA);
    });

    it("throws when the capability has no registered variants and no resolvable defaultVariantId", () => {
        const capability: CapabilityHandler = { id: "dsv-cap-empty", label: "x", defaultVariantId: variantId("dsv-unregistered-2") };
        expect(() => defaultSelectVariantId(capability, null)).toThrow(
            /No upstream API variant registered for capability "dsv-cap-empty"/,
        );
    });
});

describe("api-variants/index — extractUpstreamError", () => {
    it("returns the message from an {error:{message}} envelope", () => {
        expect(extractUpstreamError({ error: { message: "bad request" } })).toBe("bad request");
    });

    it("returns a generic marker when error is an object without a string message", () => {
        expect(extractUpstreamError({ error: { code: "invalid_request" } })).toBe("upstream error");
    });

    it("returns the error directly when it's a non-empty string", () => {
        expect(extractUpstreamError({ error: "plain string failure" })).toBe("plain string failure");
    });

    it("returns undefined when error is an empty string", () => {
        expect(extractUpstreamError({ error: "" })).toBeUndefined();
    });

    it("returns undefined when there is no error key", () => {
        expect(extractUpstreamError({})).toBeUndefined();
    });

    it("returns undefined for null/non-object json roots", () => {
        expect(extractUpstreamError(null)).toBeUndefined();
        expect(extractUpstreamError(undefined)).toBeUndefined();
        expect(extractUpstreamError("a string response")).toBeUndefined();
        expect(extractUpstreamError(42)).toBeUndefined();
    });

    it("returns undefined when error is null or a non-string primitive", () => {
        expect(extractUpstreamError({ error: null })).toBeUndefined();
        expect(extractUpstreamError({ error: 42 })).toBeUndefined();
    });
});
