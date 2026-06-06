import "server-only";
import { defineRoute } from "@/lib/server/route";

export const GET = defineRoute({
    async handler({ user }) {
        return { username: user.username, role: user.role, created_at: user.createdAt };
    },
});
