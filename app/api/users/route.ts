import "server-only";
import { NextRequest } from "next/server";
import { and, eq, like, or, count, asc, desc, SQL } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin } from "@/lib/server/auth";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        await ensureInit();
        await requireAdmin();

        const { searchParams } = new URL(req.url);
        const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
        const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("page_size") ?? "20")));
        const sort = searchParams.get("sort") ?? "-created_at";
        const keyword = searchParams.get("keyword")?.trim();
        const filterAdminRaw = searchParams.get("filter_admin");

        const filters: SQL[] = [];
        if (keyword) {
            filters.push(or(
                like(schema.users.username, `%${keyword}%`),
            )!);
        }
        if (filterAdminRaw === "true") filters.push(eq(schema.users.role, "admin"));
        else if (filterAdminRaw === "false") filters.push(eq(schema.users.role, "user"));

        const whereExpr = filters.length > 0 ? and(...filters) : undefined;

        const sortCol = sort.replace(/^-/, "");
        const sortDesc = sort.startsWith("-");
        const orderCol = sortCol === "username" ? schema.users.username : schema.users.createdAt;
        const orderExpr = sortDesc ? desc(orderCol) : asc(orderCol);

        const totalRow = db.select({ value: count() })
            .from(schema.users)
            .where(whereExpr)
            .get();
        const total = totalRow?.value ?? 0;

        const rows = db.select({
            username: schema.users.username,
            role: schema.users.role,
            created_at: schema.users.createdAt,
        })
            .from(schema.users)
            .where(whereExpr)
            .orderBy(orderExpr)
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .all();

        return ok({ items: rows, total, page, page_size: pageSize });
    } catch (err) {
        return handle(err);
    }
}
