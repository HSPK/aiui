import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, like, type SQL } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { hashPassword } from "../auth";
import { badRequest, notFound } from "../response";
import type { Paginated } from "@/lib/schemas/common";
import type { UserCreateInput, UserDTO, UserListQuery, UserUpdateInput } from "@/lib/schemas/user";

export function serializeUser(u: typeof users.$inferSelect): UserDTO {
    return { username: u.username, role: u.role, created_at: u.createdAt };
}

export function listUsers(query: UserListQuery): Paginated<UserDTO> {
    const filters: SQL[] = [];
    if (query.keyword) {
        filters.push(like(users.username, `%${query.keyword}%`));
    }
    if (query.filter_admin === "true") filters.push(eq(users.role, "admin"));
    else if (query.filter_admin === "false") filters.push(eq(users.role, "user"));

    const whereExpr = filters.length > 0 ? and(...filters) : undefined;

    const sortDesc = query.sort.startsWith("-");
    const sortCol = query.sort.replace(/^-/, "");
    const column = sortCol === "username" ? users.username : users.createdAt;
    const order = sortDesc ? desc(column) : asc(column);

    const total = db.select({ value: count() }).from(users).where(whereExpr).get()?.value ?? 0;
    const rows = db.select().from(users)
        .where(whereExpr)
        .orderBy(order)
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .all();

    return {
        items: rows.map(serializeUser),
        total,
        page: query.page,
        page_size: query.page_size,
    };
}

export async function createUser(input: UserCreateInput): Promise<UserDTO> {
    const username = input.username.trim();
    const existing = db.select().from(users).where(eq(users.username, username)).get();
    if (existing) throw badRequest("Username already exists");

    const passwordHash = await hashPassword(input.password);
    db.insert(users).values({
        id: randomUUID(),
        username,
        passwordHash,
        role: input.role,
    }).run();

    return { username, role: input.role, created_at: new Date().toISOString() };
}

export async function updateUser(username: string, input: UserUpdateInput): Promise<void> {
    const target = db.select().from(users).where(eq(users.username, username)).get();
    if (!target) throw notFound("User not found");

    const updates: Partial<typeof users.$inferInsert> = {};
    if (input.password !== undefined) updates.passwordHash = await hashPassword(input.password);
    if (input.role !== undefined) updates.role = input.role;
    if (Object.keys(updates).length === 0) return;

    db.update(users).set(updates).where(eq(users.username, username)).run();
}

export function deleteUser(username: string, actorUsername: string): void {
    if (username === actorUsername) throw badRequest("You cannot delete your own account");
    const target = db.select().from(users).where(eq(users.username, username)).get();
    if (!target) throw notFound("User not found");
    db.delete(users).where(eq(users.username, username)).run();
}
