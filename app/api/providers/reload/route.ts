import "server-only";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reload is a no-op in the new DB-backed architecture (providers are live).
// Kept for frontend compatibility; clients can refetch /providers after this.
export async function POST() {
    try {
        await ensureInit();
        await requireUser();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
