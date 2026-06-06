import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { db, schema } from "@/lib/server/db";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/server/auth";
import { badRequest, fail } from "@/lib/server/response";

const loginSchema = z.object({
    user_name: z.string().trim().min(1),
    user_password: z.string().min(1),
});

export const POST = defineRoute({
    auth: "public",
    body: loginSchema,
    async handler({ body }) {
        const username = body.user_name;
        const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
        if (!user) return fail("Invalid username or password", 401);
        const valid = await verifyPassword(body.user_password, user.passwordHash);
        if (!valid) return fail("Invalid username or password", 401);

        const token = await createSession(user.id);
        await setSessionCookie(token);

        return { username: user.username, role: user.role, created_at: user.createdAt };
    },
});
