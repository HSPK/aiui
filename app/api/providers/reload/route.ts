import "server-only";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { clearDiscoveryCache } from "@/lib/server/discovery";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flush the in-memory model discovery cache so the next request refetches
// /models from every enabled provider.
export async function POST() {
    try {
        await ensureInit();
        await requireUser();
        clearDiscoveryCache();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
