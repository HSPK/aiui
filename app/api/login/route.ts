import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { db, schema } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/password";
import { createSession, setSessionCookie } from "@/lib/server/auth";
import { fail, handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LoginBody {
    user_name?: string;
    user_password?: string;
}

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        const body = (await req.json()) as LoginBody;
        const username = body.user_name?.trim();
        const password = body.user_password ?? "";
        if (!username || !password) {
            return fail("Missing credentials", 400);
        }

        const user = db
            .select()
            .from(schema.users)
            .where(eq(schema.users.username, username))
            .get();

        if (!user) return fail("Invalid username or password", 401);
        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return fail("Invalid username or password", 401);

        const token = await createSession(user.id);
        await setSessionCookie(token);

        return ok({
            username: user.username,
            role: user.role,
            created_at: user.createdAt,
        });
    } catch (err) {
        return handle(err);
    }
}
