import "server-only";
import { NextRequest } from "next/server";
import { and, count, desc, eq, like, or } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        await ensureInit();
        const user = await requireUser();
        const { searchParams } = new URL(req.url);
        const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
        const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("page_size") ?? "20")));
        const keyword = searchParams.get("keyword")?.trim();

        const baseFilter = and(
            eq(schema.conversations.userId, user.id),
            eq(schema.conversations.isDeleted, false),
        );
        const whereExpr = keyword
            ? and(baseFilter, or(
                like(schema.conversations.title, `%${keyword}%`),
                like(schema.conversations.searchText, `%${keyword}%`),
            ))
            : baseFilter;

        const total = db.select({ value: count() }).from(schema.conversations).where(whereExpr).get()?.value ?? 0;
        const rows = db.select().from(schema.conversations)
            .where(whereExpr)
            .orderBy(desc(schema.conversations.updatedAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .all();

        const items = rows.map((c) => ({
            id: c.id,
            user_id: c.userId,
            title: c.title,
            config: c.config ?? {},
            group_id: c.groupId ?? undefined,
            search_text: c.searchText ?? undefined,
            created_at: c.createdAt,
            updated_at: c.updatedAt,
            is_deleted: !!c.isDeleted,
        }));

        return ok({ items, total, page, page_size: pageSize });
    } catch (err) {
        return handle(err);
    }
}
