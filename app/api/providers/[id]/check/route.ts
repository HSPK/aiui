import "server-only";
import { NextRequest } from "next/server";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { decryptSecret } from "@/lib/server/crypto";
import { handle, notFound, ok } from "@/lib/server/response";
import { findProviderByIdOrName } from "@/lib/server/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireUser();
        const { id } = await ctx.params;
        const provider = findProviderByIdOrName(decodeURIComponent(id));
        if (!provider) throw notFound("Provider not found");

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const key = decryptSecret(provider.apiKeyEncrypted);
        if (key) headers["Authorization"] = `Bearer ${key}`;

        const url = `${provider.baseUrl.replace(/\/$/, "")}/models`;
        const start = Date.now();
        try {
            const res = await fetch(url, { headers });
            const ms = Date.now() - start;
            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText);
                return ok({ ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, latency_ms: ms });
            }
            const json = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
            const models = Array.isArray(json?.data) ? json!.data.length : undefined;
            return ok({ ok: true, models, latency_ms: ms });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return ok({ ok: false, error: msg });
        }
    } catch (err) {
        return handle(err);
    }
}
