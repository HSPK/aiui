import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { users } from "./db/schema";
import { hashPassword } from "./password";

let bootstrapped = false;

export async function bootstrapAdmin(): Promise<void> {
    if (bootstrapped) return;
    bootstrapped = true;

    const existing = db.select().from(users).all();
    if (existing.length > 0) return;

    const username = process.env.AIUI_ADMIN_USERNAME || "admin";
    const password = process.env.AIUI_ADMIN_PASSWORD;
    if (!password) {
        console.warn(
            "[aiui] No users in database and AIUI_ADMIN_PASSWORD is not set. " +
            "Set AIUI_ADMIN_USERNAME / AIUI_ADMIN_PASSWORD to bootstrap the first admin."
        );
        return;
    }

    const passwordHash = await hashPassword(password);
    db.insert(users)
        .values({
            id: randomUUID(),
            username,
            passwordHash,
            role: "admin",
        })
        .run();
    console.log(`[aiui] Bootstrapped admin user "${username}".`);
}
