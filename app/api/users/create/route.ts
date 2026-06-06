import "server-only";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin } from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/password";
import { badRequest, handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
    username?: string;
    password?: string;
    role?: "admin" | "user";
}

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        await requireAdmin();

        const body = (await req.json()) as CreateBody;
        const username = body.username?.trim();
        const password = body.password ?? "";
        const role = body.role === "admin" ? "admin" : "user";

        if (!username) throw badRequest("Username is required");
        if (password.length < 4) throw badRequest("Password must be at least 4 characters");

        const existing = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
        if (existing) throw badRequest("Username already exists");

        const passwordHash = await hashPassword(password);
        db.insert(schema.users).values({
            id: randomUUID(),
            username,
            passwordHash,
            role,
        }).run();

        return ok({ username, role, created_at: new Date().toISOString() });
    } catch (err) {
        return handle(err);
    }
}
