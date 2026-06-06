import "server-only";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { listCapabilities } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await ensureInit();
        await requireUser();
        const items = listCapabilities().map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description ?? null,
            endpoint: c.endpoint.path,
            supports_streaming: c.supportsStreaming,
        }));
        return ok(items);
    } catch (err) {
        return handle(err);
    }
}
