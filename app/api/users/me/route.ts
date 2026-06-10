import "server-only";
import { defineRoute } from "@/lib/server/route";
import { selfPasswordSchema } from "@/lib/schemas/user";
import { changeOwnPassword } from "@/lib/server/users";

export const GET = defineRoute({
    async handler({ user }) {
        return { username: user.username, role: user.role, created_at: user.createdAt };
    },
});

export const PATCH = defineRoute({
    body: selfPasswordSchema,
    async handler({ user, body }) {
        await changeOwnPassword(user.username, body);
        return { ok: true };
    },
});
