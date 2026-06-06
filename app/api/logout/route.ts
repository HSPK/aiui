import "server-only";
import { cookies } from "next/headers";
import { clearSessionCookie, destroySession, SESSION_COOKIE } from "@/lib/server/auth";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
    try {
        const jar = await cookies();
        const token = jar.get(SESSION_COOKIE)?.value;
        await destroySession(token);
        await clearSessionCookie();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
