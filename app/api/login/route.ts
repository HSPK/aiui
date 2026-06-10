import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { db, schema } from "@/lib/server/db";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/server/auth";
import { fail, tooManyRequests } from "@/lib/server/response";
import { callerIp, checkLoginLockout, recordFailedLogin, recordSuccessfulLogin } from "@/lib/server/auth/ratelimit";
import { normalizeUsername } from "@/lib/server/users";

const loginSchema = z.object({
    user_name: z.string().trim().min(1),
    user_password: z.string().min(1),
});

/** Constant-time mitigation for username enumeration. Computed at
 *  module load from a random secret nobody knows — no password ever
 *  matches it, but `bcrypt.compare` against it takes the same
 *  ~80–100ms (at cost 10) as comparing against a real user's hash.
 *
 *  Without this an attacker can enumerate valid usernames by timing
 *  the response: existing user ~92ms (real bcrypt), missing user ~1ms
 *  (no comparison). The hash MUST be a syntactically valid bcrypt
 *  string of exactly 60 chars; a malformed hash makes bcrypt return
 *  `false` immediately and the timing window reopens. */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);

export const POST = defineRoute({
    auth: "public",
    body: loginSchema,
    async handler({ req, body }) {
        const username = normalizeUsername(body.user_name);
        const ip = callerIp(req);

        // Rate limit / lockout — defends against online brute-force.
        // Per (username, IP) so locking one victim out doesn't lock
        // legit users on different IPs; locking one IP doesn't help
        // an attacker rotating accounts on it.
        const lockedUntil = checkLoginLockout(username, ip);
        if (lockedUntil) {
            const seconds = Math.ceil((lockedUntil - Date.now()) / 1000);
            throw tooManyRequests(`Too many failed attempts — try again in ${seconds}s`, seconds);
        }

        const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
        // Timing-attack mitigation: when the user doesn't exist we
        // still run bcrypt.compare against a dummy hash so the
        // response time matches the real-user path. Without this an
        // attacker can enumerate usernames by side-channel.
        const valid = user
            ? await verifyPassword(body.user_password, user.passwordHash)
            : (await verifyPassword(body.user_password, DUMMY_HASH), false);

        if (!user || !valid) {
            recordFailedLogin(username, ip);
            return fail("Invalid username or password", 401);
        }

        recordSuccessfulLogin(username, ip);
        const token = await createSession(user.id);
        await setSessionCookie(token);

        return { username: user.username, role: user.role, created_at: user.createdAt };
    },
});
