import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin } from "@/lib/server/auth";
import { badRequest, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ username: string }> }) {
    try {
        await ensureInit();
        const admin = await requireAdmin();
        const { username } = await ctx.params;

        if (username === admin.username) {
            throw badRequest("You cannot delete your own account");
        }

        const target = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
        if (!target) throw notFound("User not found");

        db.delete(schema.users).where(eq(schema.users.username, username)).run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
