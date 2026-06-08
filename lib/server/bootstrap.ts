import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { users } from "./db/schema";
import { hashPassword } from "./auth";

let bootstrapped = false;

export async function bootstrapAdmin(): Promise<void> {
    if (bootstrapped) return;
    bootstrapped = true;

    const existing = db.select().from(users).all();
    if (existing.length > 0) return;

    const username = process.env.LOOM_ADMIN_USERNAME || "admin";
    const password = process.env.LOOM_ADMIN_PASSWORD;
    if (!password) {
        console.warn(
            "[loom] No users in database and LOOM_ADMIN_PASSWORD is not set. " +
            "Set LOOM_ADMIN_USERNAME / LOOM_ADMIN_PASSWORD to bootstrap the first admin."
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
    console.log(`[loom] Bootstrapped admin user "${username}".`);
}
