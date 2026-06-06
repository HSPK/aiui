import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { deleteUserApiKey } from "@/lib/server/apikeys";

export const DELETE = defineRoute({
    params: z.object({ id: z.string().min(1) }),
    handler: ({ user, params }) => {
        deleteUserApiKey(user.id, params.id);
    },
});
