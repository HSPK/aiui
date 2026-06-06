import "server-only";
import { cookies } from "next/headers";
import { eq, lt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users, apiKeys } from "./db/schema";
import { generateRandomToken, sha256 } from "./crypto";
import { forbidden, unauthorized } from "./response";
import type { User } from "./db/schema";

export const SESSION_COOKIE = "aiui_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface SessionUser {
    id: string;
    username: string;
    role: "admin" | "user";
    createdAt: string;
}

function userToSession(u: User): SessionUser {
    return {
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
    };
}

export async function createSession(userId: string): Promise<string> {
    const token = generateRandomToken(32);
    const id = sha256(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
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
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
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

// ---- API key auth (for OpenAI-compatible gateway) ----

export const API_KEY_PREFIX = "sk-aiui-";

export function generateApiKey(): { plain: string; prefix: string; hash: string } {
    const secret = generateRandomToken(32);
    const plain = `${API_KEY_PREFIX}${secret}`;
    return { plain, prefix: plain.slice(0, 12), hash: sha256(plain) };
}

export async function authenticateBearer(req: Request): Promise<SessionUser> {
    const header = req.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw unauthorized("Missing Bearer token");
    const token = match[1].trim();
    const hash = sha256(token);

    const rows = db
        .select({ user: users, apiKey: apiKeys })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(eq(apiKeys.keyHash, hash))
        .all();

    const row = rows[0];
    if (!row) throw unauthorized("Invalid API key");

    db.update(apiKeys)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, row.apiKey.id))
        .run();

    return userToSession(row.user);
}
