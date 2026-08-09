import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/auth")>();
    return {
        ...actual,
        getCurrentUser: vi.fn(),
        requireUser: vi.fn(),
        requireAdmin: vi.fn(),
        authenticateGateway: vi.fn(),
    };
});

import { GET as capabilitiesGET } from "@/app/api/capabilities/route";
import { GET as variantsGET } from "@/app/api/variants/route";
import { GET as adaptersGET } from "@/app/api/adapters/route";
import { resetDb, seedUser } from "../../helpers/db";
import { asAnon, asUser, envelope, getReq, toSessionUser } from "./_helpers";

// These three routes are read-only, DB-free static registries — any
// logged-in user (not just admins) may read them (e.g. to populate a
// "capability" dropdown in the playground UI).

describe("GET /api/capabilities", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await capabilitiesGET(getReq("/api/capabilities"));
        expect(res.status).toBe(401);
    });

    it("lists every registered capability for a plain user (no admin needed)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await capabilitiesGET(getReq("/api/capabilities"));
        expect(res.status).toBe(200);
        const body = await envelope<{ id: string; label: string; default_variant: string }[]>(res);
        const ids = body.data.map((c) => c.id).sort();
        expect(ids).toEqual(
            ["audio.speech", "audio.transcription", "chat", "embedding", "image", "rerank", "video"].sort(),
        );
        for (const cap of body.data) {
            expect(typeof cap.label).toBe("string");
            expect(typeof cap.default_variant).toBe("string");
        }
    });
});

describe("GET /api/variants", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await variantsGET(getReq("/api/variants"));
        expect(res.status).toBe(401);
    });

    it("lists every registered API variant", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await variantsGET(getReq("/api/variants"));
        expect(res.status).toBe(200);
        const body = await envelope<{ id: string; capability: string; path: string; supports_streaming: boolean }[]>(
            res,
        );
        const ids = body.data.map((v) => v.id).sort();
        expect(ids).toEqual(
            [
                "chat.completions",
                "responses",
                "embeddings",
                "images.generations",
                "audio.speech",
                "audio.transcriptions",
                "rerank",
                "videos",
            ].sort(),
        );
        const chatCompletions = body.data.find((v) => v.id === "chat.completions");
        expect(chatCompletions).toMatchObject({ capability: "chat", path: "/chat/completions", supports_streaming: true });
    });
});

describe("GET /api/adapters", () => {
    beforeEach(() => resetDb());

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await adaptersGET(getReq("/api/adapters"));
        expect(res.status).toBe(401);
    });

    it("lists every registered provider adapter", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await adaptersGET(getReq("/api/adapters"));
        expect(res.status).toBe(200);
        const body = await envelope<{ id: string; label: string }[]>(res);
        const ids = body.data.map((a) => a.id).sort();
        expect(ids).toEqual(["azure-foundry", "azure-openai", "openai"].sort());
    });
});
