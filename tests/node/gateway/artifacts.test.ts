// Tests for image-artifact persistence: `persistImageArtifacts`,
// `readArtifact`, `removeArtifacts`, plus the small URL/path helpers.
// LOOM_USER_CWD is a real per-test-file temp dir (tests/setup/node.ts),
// so these tests do genuine (harness-sanctioned) filesystem I/O confined
// to that directory — no /tmp usage of our own.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    artifactUrl,
    persistImageArtifacts,
    readArtifact,
    removeArtifacts,
} from "@/lib/server/gateway/artifacts";

function b64(s: string): string {
    return Buffer.from(s, "utf8").toString("base64");
}

describe("persistImageArtifacts", () => {
    it("returns [] and leaves normalized untouched when there is no data[] array", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = { id: "resp-1" };
        const result = await persistImageArtifacts(logId, normalized);
        expect(result).toEqual([]);
        expect(normalized).toEqual({ id: "resp-1" });
    });

    it("skips entries without b64_json (e.g. a hosted-url-only image response)", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = { data: [{ url: "https://upstream.example/img.png" }] };
        const result = await persistImageArtifacts(logId, normalized);
        expect(result).toEqual([]);
        expect((normalized.data as Array<Record<string, unknown>>)[0].url).toBe("https://upstream.example/img.png");
    });

    it("writes each b64_json entry to disk and rewrites the log copy with a same-origin url", async () => {
        const logId = randomUUID();
        const bytes = b64("hello-image-bytes");
        const normalized: Record<string, unknown> = {
            data: [{ b64_json: bytes, mime: "image/png", revised_prompt: "a cat" }],
        };
        const artifacts = await persistImageArtifacts(logId, normalized);

        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].index).toBe(0);
        expect(artifacts[0].mime).toBe("image/png");
        expect(artifacts[0].bytes).toBe(Buffer.from("hello-image-bytes", "utf8").byteLength);
        expect(artifacts[0].url).toBe(artifactUrl(logId, 0));

        const entry = (normalized.data as Array<Record<string, unknown>>)[0];
        expect(entry.b64_json).toBeUndefined();
        expect(entry.url).toBe(artifactUrl(logId, 0));
        expect(entry.loom_artifact).toBe(true);
        expect(entry.mime).toBe("image/png");
        expect(entry.revised_prompt).toBe("a cat"); // untouched sibling field survives
        expect(normalized.loom_artifacts).toEqual([
            { index: 0, url: artifactUrl(logId, 0), mime: "image/png", bytes: artifacts[0].bytes },
        ]);

        const read = await readArtifact(logId, 0);
        expect(read).not.toBeNull();
        expect(read?.mime).toBe("image/png");
        expect(read?.buf.toString("utf8")).toBe("hello-image-bytes");
    });

    it("infers mime from output_format when mime is absent", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = {
            data: [{ b64_json: b64("x"), output_format: "webp" }],
        };
        const artifacts = await persistImageArtifacts(logId, normalized);
        expect(artifacts[0].mime).toBe("image/webp");
        const read = await readArtifact(logId, 0);
        expect(read?.mime).toBe("image/webp");
    });

    it("defaults to image/png when neither mime nor output_format is present", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = { data: [{ b64_json: b64("x") }] };
        const artifacts = await persistImageArtifacts(logId, normalized);
        expect(artifacts[0].mime).toBe("image/png");
    });

    it.each([
        ["image/jpeg", "image/jpeg"],
        ["image/jpg", "image/jpeg"],
        ["image/gif", "image/gif"],
        ["image/tiff", "application/octet-stream"], // unrecognised -> .bin extension -> generic mime on read-back
    ])("round-trips extension mapping for %s", async (mime, expectedReadMime) => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = { data: [{ b64_json: b64("x"), mime }] };
        await persistImageArtifacts(logId, normalized);
        const read = await readArtifact(logId, 0);
        expect(read?.mime).toBe(expectedReadMime);
    });

    it("persists multiple entries at their respective indices, skipping non-b64 entries in between", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = {
            data: [
                { b64_json: b64("first") },
                { url: "https://upstream.example/skip-me.png" },
                { b64_json: b64("third") },
            ],
        };
        const artifacts = await persistImageArtifacts(logId, normalized);
        expect(artifacts.map((a) => a.index)).toEqual([0, 2]);
        expect((await readArtifact(logId, 0))?.buf.toString()).toBe("first");
        expect(await readArtifact(logId, 1)).toBeNull();
        expect((await readArtifact(logId, 2))?.buf.toString()).toBe("third");
    });

    it("strips forged loom_artifact/loom_artifacts markers and does not resurrect them when nothing real was written", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = {
            loom_artifacts: [{ index: 0, url: "javascript:alert(1)", mime: "image/png", bytes: 1 }],
            data: [{ url: "javascript:alert(1)", loom_artifact: true }],
        };
        const artifacts = await persistImageArtifacts(logId, normalized);

        expect(artifacts).toEqual([]);
        // Forged top-level marker: stripped and never resurrected (no real artifacts).
        expect(normalized.loom_artifacts).toBeUndefined();
        // Forged per-entry marker: stripped too.
        const entry = (normalized.data as Array<Record<string, unknown>>)[0];
        expect(entry.loom_artifact).toBeUndefined();
        // The entry had no b64_json, so it's otherwise passed through as-is
        // (this mirrors how a legitimate hosted-url-only response looks;
        // it's on the FE to never trust `url` on an entry lacking the
        // genuine loom_artifact marker we just stripped).
        expect(entry.url).toBe("javascript:alert(1)");
    });
});

describe("readArtifact", () => {
    it("returns null when nothing was ever written for this logId", async () => {
        const result = await readArtifact(randomUUID(), 0);
        expect(result).toBeNull();
    });

    it("returns null for an index that was never written even if the dir exists", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = { data: [{ b64_json: b64("only-index-0") }] };
        await persistImageArtifacts(logId, normalized);
        expect(await readArtifact(logId, 5)).toBeNull();
    });
});

describe("removeArtifacts", () => {
    it("deletes every artifact for a logId so subsequent reads return null", async () => {
        const logId = randomUUID();
        const normalized: Record<string, unknown> = { data: [{ b64_json: b64("gone-soon") }] };
        await persistImageArtifacts(logId, normalized);
        expect(await readArtifact(logId, 0)).not.toBeNull();

        await removeArtifacts(logId);
        expect(await readArtifact(logId, 0)).toBeNull();
    });

    it("is a safe no-op (does not throw) for a logId that was never written", async () => {
        await expect(removeArtifacts(randomUUID())).resolves.toBeUndefined();
    });
});

describe("artifactUrl", () => {
    it("builds a same-origin url with the logId + index, URL-encoding unsafe logId characters", () => {
        expect(artifactUrl("plain-id", 3)).toBe("/api/logs/generations/plain-id/images/3");
        expect(artifactUrl("id/with space", 0)).toBe(
            `/api/logs/generations/${encodeURIComponent("id/with space")}/images/0`,
        );
    });
});
