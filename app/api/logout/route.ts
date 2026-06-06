import "server-only";
import { cookies } from "next/headers";
import { defineRoute } from "@/lib/server/route";
import { SESSION_COOKIE, clearSessionCookie, destroySession } from "@/lib/server/auth";

export const POST = defineRoute({
    auth: "public",
    async handler() {
        const jar = await cookies();
        const token = jar.get(SESSION_COOKIE)?.value;
        await destroySession(token);
        await clearSessionCookie();
        return null;
    },
});
