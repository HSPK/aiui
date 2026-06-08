import "server-only";
import { cookies } from "next/headers";
import { eq, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { generateRandomToken, sha256 } from "../crypto";
import { forbidden, unauthorized } from "../response";
import { userToSession, type SessionUser } from "./types";

export const SESSION_COOKIE = "loom_session";

function sessionTtlMs(): number {
    const days = Number(process.env.LOOM_SESSION_TTL_DAYS);
    if (Number.isFinite(days) && days > 0) return days * 86400 * 1000;
    return 30 * 86400 * 1000; // 30-day default
}

export async function createSession(userId: string): Promise<string> {
    const token = generateRandomToken(32);
    const id = sha256(token);
    const expiresAt = new Date(Date.now() + sessionTtlMs());
    db.insert(sessions).values({ id, userId, expiresAt }).run();
    return token;
}

export async function setSessionCookie(token: string): Promise<void> {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: Math.floor(sessionTtlMs() / 1000),
    });
}

export async function clearSessionCookie(): Promise<void> {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
}

export async function destroySession(token: string | null | undefined): Promise<void> {
    if (!token) return;
    const id = sha256(token);
    db.delete(sessions).where(eq(sessions.id, id)).run();
}

async function readSessionToken(): Promise<string | null> {
    const jar = await cookies();
    return jar.get(SESSION_COOKIE)?.value ?? null;
}

function purgeExpired() {
    db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

export async function getCurrentUser(): Promise<SessionUser | null> {
    const token = await readSessionToken();
    if (!token) return null;
    const id = sha256(token);

    const rows = db
        .select({ user: users, session: sessions })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, id))
        .all();

    const row = rows[0];
    if (!row) return null;
    if (row.session.expiresAt.getTime() < Date.now()) {
        purgeExpired();
        return null;
    }
    return userToSession(row.user);
}

export async function requireUser(): Promise<SessionUser> {
    const user = await getCurrentUser();
    if (!user) throw unauthorized();
    return user;
}

export async function requireAdmin(): Promise<SessionUser> {
    const user = await requireUser();
    if (user.role !== "admin") throw forbidden("Admin required");
    return user;
}
