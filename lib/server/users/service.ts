import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, like, type SQL } from "drizzle-orm";
import { db } from "../db";
import { generationLogs, sessions, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth";
import { badRequest, notFound, unauthorized } from "../response";
import { removeArtifacts } from "../gateway/artifacts";
import type { Paginated } from "@/lib/schemas/common";
import type { SelfPasswordInput, UserCreateInput, UserDTO, UserListQuery, UserUpdateInput } from "@/lib/schemas/user";

/** Canonical form for username matching. SQLite `=` is case-sensitive
 *  by default, so without normalization "Alice" and "alice" become
 *  separate accounts that bypass the unique constraint. We lowercase
 *  at every write/login site so existing rows keep their casing and
 *  new accounts are normalised. */
export function normalizeUsername(raw: string): string {
    return raw.trim().toLowerCase();
}

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
    const username = normalizeUsername(input.username);
    if (!username) throw badRequest("Username cannot be empty");
    const existing = db.select().from(users).where(eq(users.username, username)).get();
    if (existing) throw badRequest("Username already exists");

    const passwordHash = await hashPassword(input.password);
    try {
        db.insert(users).values({
            id: randomUUID(),
            username,
            passwordHash,
            role: input.role,
        }).run();
    } catch (err) {
        // Concurrent createUser race: the SELECT above saw nothing
        // for both requests, both reached INSERT, the UNIQUE
        // constraint on `username` rejects the second. Map the
        // synchronous SqliteError to a clean 400 — without this the
        // caller would see a 500 and the FE retry logic might treat
        // "name taken" as "server down".
        if (
            err instanceof Error &&
            "code" in err &&
            (err as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
            throw badRequest("Username already exists");
        }
        throw err;
    }

    return { username, role: input.role, created_at: new Date().toISOString() };
}

/** Count of admins currently in the system — used to gate any
 *  operation that would remove the last admin (demote / delete) and
 *  leave the deployment with no privileged user, requiring DB surgery
 *  to recover. */
function adminCount(): number {
    return db.select({ value: count() }).from(users).where(eq(users.role, "admin")).get()?.value ?? 0;
}

export async function updateUser(username: string, input: UserUpdateInput): Promise<void> {
    const key = normalizeUsername(username);
    const target = db.select().from(users).where(eq(users.username, key)).get();
    if (!target) throw notFound("User not found");

    const updates: Partial<typeof users.$inferInsert> = {};
    if (input.password !== undefined) updates.passwordHash = await hashPassword(input.password);
    if (input.role !== undefined) {
        // Last-admin protection: demoting the only admin leaves the
        // deployment locked out (every admin-gated route returns 403),
        // recoverable only by DB surgery / restart with empty users
        // table. Refuse explicitly.
        if (target.role === "admin" && input.role !== "admin" && adminCount() <= 1) {
            throw badRequest("Cannot demote the last admin — promote another user first");
        }
        updates.role = input.role;
    }
    if (Object.keys(updates).length === 0) return;

    db.update(users).set(updates).where(eq(users.username, key)).run();

    // Security: password change should invalidate every session for
    // this user — the whole point of changing a password (compromise
    // response, rotation) is undermined if the attacker's stolen
    // cookie keeps working until 30-day natural expiry. Drop all
    // sessions for the target; their next request will 401.
    if (input.password !== undefined) {
        db.delete(sessions).where(eq(sessions.userId, target.id)).run();
    }
}

export function deleteUser(username: string, actorUsername: string): void {
    const key = normalizeUsername(username);
    if (key === normalizeUsername(actorUsername)) throw badRequest("You cannot delete your own account");
    const target = db.select().from(users).where(eq(users.username, key)).get();
    if (!target) throw notFound("User not found");
    // Last-admin protection — same reasoning as updateUser.
    if (target.role === "admin" && adminCount() <= 1) {
        throw badRequest("Cannot delete the last admin — promote another user to admin first");
    }
    // Collect logIds BEFORE the cascade fires — SQLite cascades only
    // delete DB rows, not on-disk artifacts (image-generation b64
    // blobs persisted under `data/log-artifacts/<logId>/`). Without
    // this, every image-gen log for the deleted user leaves its
    // multi-MB artifacts on disk forever, unreachable (the read
    // route requires a DB row via `assertLogReadable`) and
    // uncleanable except by `rm -rf` on the host. Snapshot the ids,
    // delete the user (cascade wipes the rows), then async-fire
    // best-effort FS cleanup — failures swallowed so a stale FS
    // entry can't block the user delete itself.
    const orphanedLogIds = db.select({ id: generationLogs.id })
        .from(generationLogs)
        .where(eq(generationLogs.userId, target.id))
        .all()
        .map((r) => r.id);
    db.delete(users).where(eq(users.username, key)).run();
    for (const id of orphanedLogIds) {
        void removeArtifacts(id);
    }
}

/** Self-service password rotation. Verifies the current password
 *  before accepting the new one so a stolen session cookie can't be
 *  used to lock the legitimate user out. All other sessions are
 *  revoked (including the caller's siblings — they re-login on next
 *  request), matching admin updateUser semantics. */
export async function changeOwnPassword(username: string, input: SelfPasswordInput): Promise<void> {
    const key = normalizeUsername(username);
    const target = db.select().from(users).where(eq(users.username, key)).get();
    if (!target) throw notFound("User not found");

    const ok = await verifyPassword(input.current_password, target.passwordHash);
    if (!ok) throw unauthorized("Current password is incorrect");

    const passwordHash = await hashPassword(input.new_password);
    db.update(users).set({ passwordHash }).where(eq(users.username, key)).run();
    db.delete(sessions).where(eq(sessions.userId, target.id)).run();
}
