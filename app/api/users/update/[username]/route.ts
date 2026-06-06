import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin } from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/password";
import { badRequest, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
    password?: string;
    role?: "admin" | "user";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ username: string }> }) {
    try {
        await ensureInit();
        await requireAdmin();

        const { username } = await ctx.params;
        const target = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
        if (!target) throw notFound("User not found");

        const body = (await req.json()) as UpdateBody;
        const updates: Partial<typeof schema.users.$inferInsert> = {};

        if (body.password !== undefined) {
            if (body.password.length < 4) throw badRequest("Password must be at least 4 characters");
            updates.passwordHash = await hashPassword(body.password);
        }
        if (body.role !== undefined) {
            updates.role = body.role === "admin" ? "admin" : "user";
        }

        if (Object.keys(updates).length === 0) {
            return ok(null);
        }

        db.update(schema.users).set(updates).where(eq(schema.users.username, username)).run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
