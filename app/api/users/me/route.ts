import "server-only";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await ensureInit();
        const user = await requireUser();
        return ok({
            username: user.username,
            role: user.role,
            created_at: user.createdAt,
        });
    } catch (err) {
        return handle(err);
    }
}
