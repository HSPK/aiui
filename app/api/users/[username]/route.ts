import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { userUpdateSchema } from "@/lib/schemas/user";
import { deleteUser, updateUser } from "@/lib/server/users";

const paramsSchema = z.object({ username: z.string().min(1) });

export const PATCH = defineRoute({
    auth: "admin",
    params: paramsSchema,
    body: userUpdateSchema,
    handler: async ({ params, body }) => {
        await updateUser(params.username, body);
    },
});

export const DELETE = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: ({ params, user }) => deleteUser(params.username, user.username),
});
